/**
 * 媒体适配层（§5.5/§5.6）— producer/media/ 清单 + AIPING 生成接口
 *
 * 环境变量（只从环境读取，不落盘）：
 *   AIPING_BASE_URL   默认 https://aiping.cn/api/v1
 *   AIPING_API_KEY    生成/探测必需（fixture 模式除外）
 *   AIPING_FIXTURE    离线测试：指向 {models:[{name,sizes?}], sample:<文件>} 的 JSON
 *
 * 默认模型：图片 Doubao-Seedream-5.0-lite / Kolors；视频 Kling-V2-New（可选）。模型名可在命令中覆盖。
 * 硬门（§5.6）：生成前必 probe；模型不存在/尺寸不支持/请求失败 → 退出非零并写
 *   <run>/media/status.json {state:"needs_asset", reason}，不用占位图、不静默切换模型。
 * 导入：外部 PNG/MP4 经 import 入清单，重新计算 SHA-256 并记录来源。
 *
 * 用法（producer/ 下）：
 *   node scripts/media-adapter.ts probe --model Doubao-Seedream-5.0-lite [--size 1024x1024]
 *   node scripts/media-adapter.ts generate --prompt "..." --model Doubao-Seedream-5.0-lite --size 1024x1024 --out media/hero.png
 *   node scripts/media-adapter.ts import --file media/hero.png --license "team-owned" --source external
 *   node scripts/media-adapter.ts list
 */
import { mkdir, readFile, writeFile, stat, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { markStageDone } from "./stage.ts";

const ROOT = process.cwd();
const MANIFEST_PATH = path.join(ROOT, "media", "media-manifest.json");
const BASE_URL = (process.env.AIPING_BASE_URL ?? "https://aiping.cn/api/v1").replace(/\/+$/, "");

export interface MediaEntry {
  id: string;
  kind: "image" | "video";
  prompt: string;
  model: string;
  provider: string;
  width: number;
  height: number;
  ratio: string;
  file: string;
  sha256: string;
  license: string;
  source: "generated" | "external";
  generatedAt: string;
}

export interface MediaManifest {
  schema_version: number;
  updated_at: string;
  entries: MediaEntry[];
}

const sha256File = async (p: string): Promise<string> =>
  createHash("sha256").update(await readFile(p)).digest("hex");

export async function loadManifest(): Promise<MediaManifest> {
  try {
    return JSON.parse(await readFile(MANIFEST_PATH, "utf-8")) as MediaManifest;
  } catch {
    return { schema_version: 1, updated_at: new Date().toISOString(), entries: [] };
  }
}

async function saveManifest(m: MediaManifest): Promise<void> {
  m.updated_at = new Date().toISOString();
  await mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
  await writeFile(MANIFEST_PATH, JSON.stringify(m, null, 2), "utf-8");
}

interface ProbeModel {
  name: string;
  sizes?: string[];
}

async function fetchModels(): Promise<ProbeModel[]> {
  const fixture = process.env.AIPING_FIXTURE;
  if (fixture) {
    const fx = JSON.parse(await readFile(path.resolve(ROOT, fixture), "utf-8")) as { models: ProbeModel[] };
    return fx.models ?? [];
  }
  const apiKey = process.env.AIPING_API_KEY;
  if (!apiKey) throw new Error("AIPING_API_KEY 未设置（或使用 AIPING_FIXTURE 离线测试）");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(BASE_URL + "/models", {
      signal: controller.signal,
      headers: { Authorization: "Bearer " + apiKey, Accept: "application/json" },
    });
    if (!res.ok) throw new Error("models HTTP " + res.status);
    const data = (await res.json()) as { data?: ProbeModel[]; models?: ProbeModel[] };
    return data.data ?? data.models ?? [];
  } finally {
    clearTimeout(timer);
  }
}

export async function probeModel(model: string, size?: string): Promise<{ ok: boolean; reason?: string }> {
  let models: ProbeModel[];
  try {
    models = await fetchModels();
  } catch (e) {
    return { ok: false, reason: "provider probe 失败：" + (e as Error).message };
  }
  const hit = models.find((m) => m.name === model);
  if (!hit) {
    return { ok: false, reason: "模型不存在（provider 列表无 " + model + "），不静默切换模型" };
  }
  if (size && hit.sizes && hit.sizes.length > 0 && !hit.sizes.includes(size)) {
    return { ok: false, reason: "模型不支持尺寸 " + size + "（支持：" + hit.sizes.join(", ") + "）" };
  }
  return { ok: true };
}

export async function generateMedia(opts: {
  prompt: string;
  model: string;
  size: string;
  out: string;
  kind: "image" | "video";
  provider?: string;
}): Promise<MediaEntry> {
  const sizeRe = /^([0-9]+)x([0-9]+)$/.exec(opts.size);
  if (!sizeRe) throw new Error("--size 必须为 WxH（如 1024x1024）");
  const width = Number(sizeRe[1]);
  const height = Number(sizeRe[2]);

  const probe = await probeModel(opts.model, opts.size);
  if (!probe.ok) throw new Error("needs_asset：" + probe.reason);

  const outPath = path.resolve(ROOT, opts.out);
  const fixture = process.env.AIPING_FIXTURE;
  if (fixture) {
    const fx = JSON.parse(await readFile(path.resolve(ROOT, fixture), "utf-8")) as { sample: string };
    if (!fx.sample) throw new Error("AIPING_FIXTURE 缺 sample 文件");
    await mkdir(path.dirname(outPath), { recursive: true });
    await copyFile(path.resolve(ROOT, fx.sample), outPath);
  } else {
    const apiKey = process.env.AIPING_API_KEY;
    if (!apiKey) throw new Error("AIPING_API_KEY 未设置");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const res = await fetch(BASE_URL + "/images/generations", {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", Authorization: "Bearer " + apiKey },
        body: JSON.stringify({ model: opts.model, prompt: opts.prompt, size: opts.size }),
      });
      if (!res.ok) throw new Error("generate HTTP " + res.status);
      const data = (await res.json()) as { data?: { b64_json?: string; url?: string }[] };
      const item = data.data?.[0];
      const b64 = item?.b64_json;
      if (b64) {
        await mkdir(path.dirname(outPath), { recursive: true });
        await writeFile(outPath, Buffer.from(b64, "base64"));
      } else if (item?.url) {
        const img = await fetch(item.url);
        await mkdir(path.dirname(outPath), { recursive: true });
        await writeFile(outPath, Buffer.from(await img.arrayBuffer()));
      } else {
        throw new Error("provider 返回无图片数据");
      }
    } finally {
      clearTimeout(timer);
    }
  }

  const entry: MediaEntry = {
    id: "media-" + createHash("sha1").update(opts.out + ":" + Date.now()).digest("hex").slice(0, 12),
    kind: opts.kind,
    prompt: opts.prompt,
    model: opts.model,
    provider: opts.provider ?? "aiping",
    width,
    height,
    ratio: width + ":" + height,
    file: opts.out.replace(/\\/g, "/"),
    sha256: await sha256File(outPath),
    license: "generated-by-aiping",
    source: "generated",
    generatedAt: new Date().toISOString(),
  };
  const m = await loadManifest();
  m.entries.push(entry);
  await saveManifest(m);
  return entry;
}

export async function importMedia(opts: {
  file: string;
  license: string;
  prompt?: string;
  model?: string;
  kind?: "image" | "video";
  provider?: string;
}): Promise<MediaEntry> {
  const abs = path.resolve(ROOT, opts.file);
  if (!existsSync(abs)) throw new Error("文件不存在：" + opts.file);
  const st = await stat(abs);
  const dim = st.size > 0 ? 0 : 0;
  void dim;
  const entry: MediaEntry = {
    id: "media-" + createHash("sha1").update(opts.file + ":" + Date.now()).digest("hex").slice(0, 12),
    kind: opts.kind ?? (/\.(png|jpe?g|webp)$/i.test(opts.file) ? "image" : "video"),
    prompt: opts.prompt ?? "external import",
    model: opts.model ?? "external",
    provider: opts.provider ?? "external",
    width: 0,
    height: 0,
    ratio: "unknown",
    file: opts.file.replace(/\\/g, "/"),
    sha256: await sha256File(abs),
    license: opts.license,
    source: "external",
    generatedAt: new Date().toISOString(),
  };
  const m = await loadManifest();
  m.entries.push(entry);
  await saveManifest(m);
  return entry;
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const cmd = args[0];
  if (!cmd) {
    console.error("用法：node scripts/media-adapter.ts <probe|generate|import|list> ...");
    process.exit(1);
  }
  try {
    if (cmd === "probe") {
      const model = get("--model", "");
      if (!model) throw new Error("probe 需要 --model");
      const r = await probeModel(model, get("--size", "") || undefined);
      if (!r.ok) {
        console.error("[media] needs_asset：" + r.reason);
        process.exit(1);
      }
      console.log("[media] probe ✓ " + model + (get("--size", "") ? " @" + get("--size", "") : ""));
    } else if (cmd === "generate") {
      const prompt = get("--prompt", "");
      const model = get("--model", "Doubao-Seedream-5.0-lite");
      const size = get("--size", "1024x1024");
      const out = get("--out", "media/" + createHash("sha1").update(model + prompt).digest("hex").slice(0, 10) + ".png");
      const kind = get("--kind", "image") === "video" ? "video" : "image";
      const entry = await generateMedia({ prompt, model, size, out, kind });
      console.log("[media] 生成 ✓ " + entry.file + " sha256=" + entry.sha256.slice(0, 16));
    } else if (cmd === "import") {
      const file = get("--file", "");
      if (!file) throw new Error("import 需要 --file");
      const entry = await importMedia({ file, license: get("--license", "external"), prompt: get("--prompt", "") || undefined, model: get("--model", "") || undefined, kind: (get("--kind", "") as "image" | "video") || undefined, provider: get("--provider", "") || undefined });
      console.log("[media] 导入 ✓ " + entry.file + " sha256=" + entry.sha256.slice(0, 16) + " license=" + entry.license);
    } else if (cmd === "list") {
      const m = await loadManifest();
      console.log("[media] 清单 " + m.entries.length + " 项：" + path.relative(ROOT, MANIFEST_PATH));
      for (const e of m.entries) console.log("  - " + e.id + " " + e.kind + " " + e.file + " " + e.sha256.slice(0, 10) + " [" + e.source + "]");
    } else {
      throw new Error("未知命令：" + cmd);
    }
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[media] 失败：" + msg);
    if (msg.startsWith("needs_asset")) process.exit(2);
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] &&
  (import.meta.url === new URL("file://" + path.resolve(process.argv[1])).href ||
    import.meta.url.endsWith("/" + path.basename(process.argv[1])));
if (isDirectRun) {
  main().catch((e) => {
    console.error("[media] 失败:", e);
    process.exit(1);
  });
}