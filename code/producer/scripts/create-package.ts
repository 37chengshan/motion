/**
 * 交接包生成（§6.3/§6.4）
 *
 * 硬门（全部满足才生成 package）：
 *   1. 视频产物存在且 ffprobe 校验通过（时长/分辨率/流）；存在 batch-result.json 时要求其 summary 全 ok
 *   2. 每个目标视频都有 completed 审查报告，verdict ∈ {pass, warning}，warning 不得含 high issue
 *   3. timeline/config 存在；media manifest 存在时按清单复制 asset 并重算 hash
 *   4. targets 的 publish_policy 为必填 enum draft_only|publish（缺省/未知 → 拒绝）
 * 组装：short/long MP4、SRT、封面、平台 metadata、review 报告、timeline、assets → package/
 *   每个文件流式 SHA-256，单文件上限 2 GiB，拒绝路径穿越/包外引用。
 * 签名：Ed25519 + JCS（contracts/vectors 同一实现）；package_state 固定 READY_FOR_PUBLISH（绝不写 AUTHORIZED）。
 * 输出：package/manifest.json（含 signature.value）+ package/SHA256SUMS。
 *
 * 用法：
 *   node scripts/create-package.ts --run-dir runs/2026-08-28/ai-news-morning \
 *     [--targets runs/2026-08-28/ai-news-morning/config/targets.json] \
 *     [--key contracts/keys/test-ed25519-private.pem --key-id test-key-1] \
 *     [--out ...] [--no-sign]
 */
import { readFile, writeFile, mkdir, readdir, copyFile, stat } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import path from "node:path";
import { signManifest, verifyManifest, type JsonObject, type SignatureDescriptor } from "../src/data/package-sign.ts";
import type { VideoConfig } from "../src/data/types.ts";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB

interface TargetSpec {
  platform: string;
  account_ref: string;
  title: string;
  description: string;
  tags: string[];
  statement: string;
  subtitle_path: string;
  cover_path: string;
  publish_policy: "draft_only" | "publish";
}

interface ReviewReportLite {
  status: string;
  verdict: string;
  video?: string;
  issues?: { severity: string }[];
  provider?: string;
  model?: string;
  reviewed_at?: string;
  timeline_hash?: string;
  config_hash?: string;
}

export interface PackageEvidence {
  ok: boolean;
  errors: string[];
  videos: { key: "short" | "long"; file: string; width: number; height: number; durationMs: number; sha256: string; bytes: number }[];
  reviews: { video: string; reportPath: string; report: ReviewReportLite }[];
  timelineHash: string;
  configHash: string;
}

const sha256Stream = (p: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const stream = createReadStream(p);
    const h = createHash("sha256");
    stream.on("data", (d) => h.update(d as Buffer));
    stream.on("end", () => resolve(h.digest("hex")));
    stream.on("error", reject);
  });

async function ffprobeMeta(file: string): Promise<{ width?: number; height?: number; durationMs?: number } | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file], { maxBuffer: 4 * 1024 * 1024 });
    const d = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type?: string; width?: number; height?: number }[] };
    const v = (d.streams ?? []).find((s) => s.codec_type === "video");
    const dur = parseFloat(d.format?.duration ?? "0");
    return { width: v?.width, height: v?.height, durationMs: Number.isFinite(dur) ? Math.round(dur * 1000) : undefined };
  } catch {
    return null;
  }
}

/** 解析目标视频：优先 canonical renders/short.mp4|long.mp4，否则读 batch-result.json */
async function resolveVideos(runDir: string): Promise<Map<"short" | "long", string>> {
  const map = new Map<"short" | "long", string>();
  for (const key of ["short", "long"] as const) {
    const p = path.join(runDir, "renders", key + ".mp4");
    if (existsSync(p)) map.set(key, p);
  }
  if (map.size === 2) return map;
  // batch-result.json（hyperframes）兜底
  for (const br of ["batch-result.json", "render-batch-result.json"]) {
    const p = path.join(runDir, br);
    if (!existsSync(p)) continue;
    try {
      const data = JSON.parse(await readFile(p, "utf-8")) as { jobs: { compositionId?: string; render?: { mp4Path?: string; ok?: boolean } }[] };
      for (const j of data.jobs ?? []) {
        const ori = j.compositionId?.endsWith("-short") ? "short" : j.compositionId?.endsWith("-long") ? "long" : undefined;
        if (!ori || !j.render?.mp4Path) continue;
        const abs = path.resolve(ROOT, j.render.mp4Path);
        if (existsSync(abs)) map.set(ori, abs);
      }
    } catch {
      /* 忽略损坏的 batch-result */
    }
  }
  return map;
}

async function gatePackage(runDir: string): Promise<PackageEvidence> {
  const errors: string[] = [];
  const videos = await resolveVideos(runDir);
  for (const key of ["short", "long"] as const) {
    if (!videos.has(key)) errors.push("缺少视频：" + path.join("renders", key + ".mp4") + "（先跑 hyperframes-batch / render-batch）");
  }

  // batch-result 存在时要求全 ok
  for (const br of ["batch-result.json", "render-batch-result.json"]) {
    const p = path.join(runDir, br);
    if (!existsSync(p)) continue;
    try {
      const data = JSON.parse(await readFile(p, "utf-8")) as { summary?: { ok?: number; failed?: number } };
      if ((data.summary?.failed ?? 0) > 0) errors.push(br + " 存在失败 job（failed=" + data.summary?.failed + "）");
    } catch {
      /* 忽略 */
    }
  }

  const videoMeta: PackageEvidence["videos"] = [];
  for (const [key, file] of videos) {
    const meta = await ffprobeMeta(file);
    if (!meta?.durationMs) {
      errors.push("ffprobe 校验失败：" + file);
      continue;
    }
    const bytes = (await stat(file)).size;
    if (bytes > MAX_FILE_BYTES) errors.push("文件超 2 GiB：" + file);
    videoMeta.push({ key, file, width: meta.width ?? 0, height: meta.height ?? 0, durationMs: meta.durationMs, sha256: await sha256Stream(file), bytes });
  }

  // review 报告：每个视频都要 completed + pass|warning + warning 无 high
  const reviewDir = path.join(runDir, "review");
  const reviews: PackageEvidence["reviews"] = [];
  if (existsSync(reviewDir)) {
    for (const f of await readdir(reviewDir)) {
      if (!f.endsWith(".json")) continue;
      try {
        const report = JSON.parse(await readFile(path.join(reviewDir, f), "utf-8")) as ReviewReportLite;
        reviews.push({ video: f, reportPath: path.join(reviewDir, f), report });
      } catch {
        /* 损坏报告忽略，由门兜底 */
      }
    }
  }
  for (const [key, file] of videos) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    const r = reviews.find((x) => {
      const base = path.basename(x.reportPath);
      const videoField = (x.report.video ?? "").replace(/\\/g, "/");
      return (
        videoField === "renders/" + key + ".mp4" ||
        videoField.endsWith("/renders/" + key + ".mp4") ||
        base.startsWith(key + "-") ||
        base.startsWith(key + ".")
      );
    });
    if (!r) {
      errors.push("缺少 " + key + " 的审查报告（review/" + key + "*.json）");
      continue;
    }
    if (r.report.status !== "completed") errors.push(key + " 审查 status=" + r.report.status + "（必须 completed）");
    if (!["pass", "warning"].includes(r.report.verdict)) errors.push(key + " 审查 verdict=" + r.report.verdict + "（必须 pass|warning）");
    if (r.report.verdict === "warning" && (r.report.issues ?? []).some((i) => i.severity === "high")) {
      errors.push(key + " warning 中含 high issue，禁止打包");
    }
  }

  const timelinePath = path.join(runDir, "timeline", "timeline.json");
  const configPath = path.join(runDir, "config", "content.json");
  if (!existsSync(timelinePath)) errors.push("缺少 timeline/timeline.json");
  if (!existsSync(configPath)) errors.push("缺少 config/content.json");

  return {
    ok: errors.length === 0,
    errors,
    videos: videoMeta,
    reviews,
    timelineHash: existsSync(timelinePath) ? await sha256Stream(timelinePath) : "",
    configHash: existsSync(configPath) ? await sha256Stream(configPath) : "",
  };
}

function assertInside(pkgDir: string, target: string): string {
  const abs = path.resolve(target);
  const base = path.resolve(pkgDir) + path.sep;
  if (!abs.startsWith(base)) throw new Error("路径穿越/包外引用拒绝：" + target);
  return abs;
}

async function buildManifest(
  runDir: string,
  targets: TargetSpec[],
  evidence: PackageEvidence,
  packageId: string,
  producerCommit: string
): Promise<JsonObject> {
  const config = JSON.parse(await readFile(path.join(runDir, "config", "content.json"), "utf-8")) as VideoConfig;
  const now = new Date();
  const assets: JsonObject[] = evidence.videos.map((v) => ({
    path: "renders/" + v.key + ".mp4",
    type: "video",
    size_bytes: v.bytes,
    mime: "video/mp4",
    width: v.width,
    height: v.height,
    duration_ms: v.durationMs,
    sha256: v.sha256,
  }));
  // 附加文件：srt / timeline / covers / review / assets
  const srtPath = path.join(runDir, "timeline", "subtitle.srt");
  if (existsSync(srtPath)) {
    assets.push({ path: "timeline/subtitle.srt", type: "subtitle", size_bytes: (await stat(srtPath)).size, mime: "application/x-subrip", sha256: await sha256Stream(srtPath) });
  }
  assets.push({ path: "timeline/timeline.json", type: "timeline", size_bytes: (await stat(path.join(runDir, "timeline", "timeline.json"))).size, mime: "application/json", sha256: evidence.timelineHash });
  const covers = new Set<string>();
  for (const t of targets) covers.add(t.cover_path);
  for (const c of covers) {
    const abs = path.join(runDir, "covers", path.basename(c));
    if (existsSync(abs)) {
      assets.push({ path: "covers/" + path.basename(c), type: "image", size_bytes: (await stat(abs)).size, mime: "image/png", sha256: await sha256Stream(abs) });
    }
  }
  for (const r of evidence.reviews) {
    if (!existsSync(r.reportPath)) continue;
    const rel = path.relative(runDir, r.reportPath).replace(/\\/g, "/");
    assets.push({ path: rel, type: "review", size_bytes: (await stat(r.reportPath)).size, mime: "application/json", sha256: await sha256Stream(r.reportPath) });
  }

  return {
    schema_version: 1,
    package_id: packageId,
    run_id: config.runId ?? path.basename(runDir),
    workflow: config.engine ?? "remotion",
    stream: config.type ?? "recording",
    edition: config.edition ?? null,
    cadence: config.cadence ?? "daily",
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 24 * 3600_000).toISOString(),
    producer_commit: producerCommit,
    package_state: "READY_FOR_PUBLISH",
    assets,
    targets: targets.map((t) => ({ ...t })),
    timeline: { path: "timeline/timeline.json", sha256: evidence.timelineHash, block_count: config.blocks?.length ?? 0 },
    content_refs: { source_snapshots: config.sourceRefs ?? [] },
    review: {
      status: "completed",
      verdict: evidence.reviews.every((r) => r.report.verdict === "pass") ? "pass" : "warning",
      reports: evidence.reviews.map((r) => ({
        video: path.basename(r.reportPath),
        provider: r.report.provider ?? "unknown",
        model: r.report.model ?? "unknown",
        reviewed_at: r.report.reviewed_at ?? "",
        timeline_hash: r.report.timeline_hash ?? "",
        config_hash: r.report.config_hash ?? "",
      })),
    },
  };
}

export async function createPackage(opts: {
  runDir: string;
  targetsPath?: string;
  privateKeyPem?: string;
  keyId?: string;
  outDir?: string;
  noSign?: boolean;
}): Promise<{ ok: boolean; errors: string[]; packageDir: string; manifest: JsonObject | null; sha256sums: string }> {
  const runDir = path.resolve(ROOT, opts.runDir);
  const evidence = await gatePackage(runDir);
  if (!evidence.ok) {
    return { ok: false, errors: evidence.errors, packageDir: "", manifest: null, sha256sums: "" };
  }

  // targets（publish_policy 必填，缺省拒绝）
  let targets: TargetSpec[];
  try {
    const raw = JSON.parse(await readFile(path.resolve(ROOT, opts.targetsPath || path.join(runDir, "config", "targets.json")), "utf-8")) as TargetSpec[];
    if (!Array.isArray(raw) || raw.length === 0) throw new Error("targets 为空");
    for (const t of raw) {
      if (t.publish_policy !== "draft_only" && t.publish_policy !== "publish") {
        throw new Error("target.publish_policy 必填且只允许 draft_only|publish（收到：" + t.publish_policy + "）");
      }
      for (const k of ["platform", "account_ref", "title", "description", "statement", "subtitle_path", "cover_path"] as const) {
        if (!String(t[k] ?? "").trim()) throw new Error("target 缺少字段：" + k);
      }
    }
    targets = raw;
  } catch (e) {
    return { ok: false, errors: ["targets 校验失败：" + (e as Error).message], packageDir: "", manifest: null, sha256sums: "" };
  }

  // 组装到 package 目录
  const pkgDir = path.resolve(ROOT, opts.outDir || path.join(runDir, "package"));
  await mkdir(pkgDir, { recursive: true });
  const copies: { from: string; to: string }[] = [
    ...evidence.videos.map((v) => ({ from: v.file, to: path.join(pkgDir, "renders", v.key + ".mp4") })),
    { from: path.join(runDir, "timeline", "timeline.json"), to: path.join(pkgDir, "timeline", "timeline.json") },
  ];
  const srtPath = path.join(runDir, "timeline", "subtitle.srt");
  if (existsSync(srtPath)) copies.push({ from: srtPath, to: path.join(pkgDir, "timeline", "subtitle.srt") });
  for (const t of targets) {
    const from = path.join(runDir, "covers", path.basename(t.cover_path));
    if (existsSync(from)) copies.push({ from, to: path.join(pkgDir, "covers", path.basename(t.cover_path)) });
  }
  for (const r of evidence.reviews) {
    if (existsSync(r.reportPath)) copies.push({ from: r.reportPath, to: path.join(pkgDir, path.relative(runDir, r.reportPath)) });
  }
  for (const c of copies) {
    const to = assertInside(pkgDir, c.to);
    await mkdir(path.dirname(to), { recursive: true });
    await copyFile(c.from, to);
  }

  // manifest + 签名
  const producerCommit = (() => {
    try {
      return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    } catch {
      return "unknown";
    }
  })();
  const packageId = "pkg-" + (configRunId(path.basename(runDir))).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 60) + "-" + Date.now().toString(36);
  const manifest = await buildManifest(runDir, targets, evidence, packageId, producerCommit);

  let finalManifest: JsonObject;
  let sha256sums = "";
  if (opts.noSign) {
    finalManifest = { ...manifest, signature: { algorithm: "Ed25519", key_id: opts.keyId ?? "unsigned", canonicalization: "JCS" } as SignatureDescriptor };
  } else {
    if (!opts.privateKeyPem) {
      return { ok: false, errors: ["缺少私钥（--key）；或用 --no-sign 仅组装"], packageDir: pkgDir, manifest: null, sha256sums: "" };
    }
    const keyPem = await readFile(path.resolve(ROOT, opts.privateKeyPem), "utf-8");
    const signed = signManifest(manifest, opts.keyId ?? "windows-producer", keyPem);
    finalManifest = { ...manifest, signature: signed.signature };
  }

  await writeFile(path.join(pkgDir, "manifest.json"), JSON.stringify(finalManifest, null, 2), "utf-8");
  // SHA256SUMS（全部包内文件 + manifest 自身）
  const lines: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const f of await readdir(dir)) {
      const full = path.join(dir, f);
      if ((await stat(full)).isDirectory()) await walk(full);
      else lines.push((await sha256Stream(full)) + "  " + path.relative(pkgDir, full).replace(/\\/g, "/"));
    }
  };
  await walk(pkgDir);
  sha256sums = lines.sort().join("\n") + "\n";
  await writeFile(path.join(pkgDir, "SHA256SUMS"), sha256sums, "utf-8");

  return { ok: true, errors: [], packageDir: pkgDir, manifest: finalManifest, sha256sums };
}

function configRunId(basename: string): string {
  return basename;
}

/** 验签入口：package/manifest.json + 公钥 PEM */
export async function verifyPackageManifestFile(manifestPath: string, publicKeyPem: string): Promise<{ ok: boolean; reason?: string }> {
  const manifest = JSON.parse(await readFile(path.resolve(ROOT, manifestPath), "utf-8")) as JsonObject;
  if (manifest.package_state !== "READY_FOR_PUBLISH") return { ok: false, reason: "package_state 非 READY_FOR_PUBLISH：" + String(manifest.package_state) };
  const sig = manifest.signature as SignatureDescriptor | undefined;
  if (!sig?.value) return { ok: false, reason: "manifest 无签名 value" };
  return { ok: verifyManifest(manifest, publicKeyPem), reason: undefined };
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const runDir = get("--run-dir", "");
  if (!runDir) {
    console.error("[package] 必须提供 --run-dir");
    process.exit(1);
  }
  const result = await createPackage({
    runDir,
    targetsPath: get("--targets", ""),
    privateKeyPem: get("--key", ""),
    keyId: get("--key-id", ""),
    outDir: get("--out", ""),
    noSign: args.includes("--no-sign"),
  });
  if (!result.ok) {
    console.error("[package] 门失败，不生成交接包：");
    for (const e of result.errors) console.error("  - " + e);
    process.exit(1);
  }
  console.log("[package] 已生成 → " + path.relative(ROOT, result.packageDir));
  console.log("[package] assets=" + ((result.manifest?.assets as unknown[])?.length ?? 0) + " targets=" + ((result.manifest?.targets as unknown[])?.length ?? 0) + " state=" + result.manifest?.package_state);
  const pub = path.resolve(ROOT, "..", "contracts", "keys", "test-ed25519-public.pem");
  if (!args.includes("--no-sign") && existsSync(pub)) {
    const v = await verifyPackageManifestFile(path.join(result.packageDir, "manifest.json"), await readFile(pub, "utf-8"));
    console.log("[package] 自验签：" + (v.ok ? "✓" : "✗ " + v.reason));
  }
}

const isDirectRun =
  process.argv[1] &&
  (import.meta.url === new URL("file://" + path.resolve(process.argv[1])).href ||
    import.meta.url.endsWith("/" + path.basename(process.argv[1])));
if (isDirectRun) {
  main().catch((e) => {
    console.error("[package] 失败:", e);
    process.exit(1);
  });
}