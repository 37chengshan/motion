/**
 * HyperFrames 批量生成（§4.3/4.4/4.5）
 *
 * batch.json 每项固定字段：
 *   { runId, configPath, timelinePath, outputDir, orientations: ["short","long"], quality, expectedDurationSec }
 *
 * 流程（单 job 内 short/long 顺序执行，避免 Chromium/FFmpeg 资源争抢；job 之间按 --concurrency 并行）：
 *   generate（§4.1 生成器，组合 ID hf-<run-id>-<orientation>）
 *   → hyperframes check --strict（check 全过才 render）
 *   → snapshot 中点/末点（render 前）
 *   → hyperframes render --quality <quality> --output <mp4>
 *   → ffprobe 校验封装时长/分辨率/视频流/音频流
 *   → 可选整片 review（--review 调 review-video.ts；§4.5：check 通过 ≠ 成片通过）
 *
 * 注意（实测）：
 *   - hyperframes check 失败时退出码仍为 0，必须以输出中的 "Check failed" 标记为准；
 *   - 子进程 stdin 接 /dev/null（stdio ignore），避免 hyperframes 的交互提示阻塞批处理；
 *   - CLI 可用 "npx hyperframes"（含空格）或 HYPERFRAMES_CLI 单路径覆盖。
 *
 * 产物：batch-result.json（机器可读，每项记录 check/render exit code、MP4 路径、字节数、
 *       duration、SHA-256、错误日志路径）；任一 job 失败不吞错、保留其他成功 job，整体退出非零。
 *
 * 用法（producer/ 下）：
 *   node scripts/hyperframes-batch.ts --batch runs/2026-08-28/batch.json [--concurrency 2] [--review]
 */
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { generateHyperframes } from "./gen-hyperframes.ts";
import { markStageDone } from "./stage.ts";

const ROOT = process.cwd();

interface BatchItem {
  runId: string;
  configPath: string;
  timelinePath: string;
  outputDir?: string;
  orientations: ("short" | "long")[];
  quality: string;
  expectedDurationSec: number;
}

interface JobResult {
  runId: string;
  compositionId: string;
  orientation: "short" | "long";
  generated: { ok: boolean; error?: string };
  check: { ok: boolean; exitCode: number | null; errorLog?: string };
  snapshots: { at: "mid" | "end"; path: string; ok: boolean }[];
  render: {
    ok: boolean;
    exitCode: number | null;
    mp4Path?: string;
    bytes?: number;
    durationSec?: number;
    sha256?: string;
    errorLog?: string;
  };
  ffprobe: {
    ok: boolean;
    durationSec?: number;
    width?: number;
    height?: number;
    hasVideo?: boolean;
    hasAudio?: boolean;
    error?: string;
  };
  review: { ok: boolean; reportPath?: string; skipped: boolean; error?: string };
  expectedDurationSec: number;
}

function sha256File(p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    const stream = createReadStream(p);
    stream.on("data", (d) => h.update(d as Buffer));
    stream.on("end", () => resolve(h.digest("hex")));
    stream.on("error", reject);
  });
}

/** 子进程运行：stdin 忽略（EOF），stdout/stderr 合并返回 */
function run(cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: env ?? process.env, stdio: ["ignore", "pipe", "pipe"], shell: false });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => resolve({ exitCode: code ?? 1, output: (out + err).trim() }));
    child.on("error", (e) => resolve({ exitCode: 1, output: "spawn error: " + e.message }));
  });
}

async function ffprobeProbe(mp4: string): Promise<{ ok: boolean; durationSec?: number; width?: number; height?: number; hasVideo?: boolean; hasAudio?: boolean; error?: string }> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height",
      "-of", "json", mp4,
    ], { maxBuffer: 4 * 1024 * 1024 });
    const data = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: { codec_type?: string; width?: number; height?: number }[];
    };
    const durationSec = parseFloat(data.format?.duration ?? "0");
    const video = (data.streams ?? []).find((s) => s.codec_type === "video");
    const audio = (data.streams ?? []).find((s) => s.codec_type === "audio");
    const ok = Number.isFinite(durationSec) && durationSec > 0 && Boolean(video);
    return {
      ok,
      durationSec: Number.isFinite(durationSec) ? durationSec : undefined,
      width: video?.width,
      height: video?.height,
      hasVideo: Boolean(video),
      hasAudio: Boolean(audio),
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function writeErrorLog(p: string, output: string): Promise<void> {
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, output, "utf-8");
}

async function processOrientation(
  item: BatchItem,
  orientation: "short" | "long",
  cli: string,
  cliBase: string[],
  doReview: boolean
): Promise<JobResult> {
  const compId = "hf-" + item.runId + "-" + orientation;
  const runDir = path.resolve(ROOT, path.dirname(path.dirname(item.configPath)));
  const outDir = path.resolve(ROOT, item.outputDir ?? path.join(runDir, "hyperframes", compId));
  const mp4Path = path.join(runDir, "renders", compId + ".mp4");
  const result: JobResult = {
    runId: item.runId,
    compositionId: compId,
    orientation,
    generated: { ok: false },
    check: { ok: false, exitCode: null },
    snapshots: [],
    render: { ok: false, exitCode: null },
    ffprobe: { ok: false },
    review: { ok: false, skipped: true },
    expectedDurationSec: item.expectedDurationSec,
  };

  // 1) generate
  try {
    const art = await generateHyperframes({
      runId: item.runId,
      configPath: item.configPath,
      timelinePath: item.timelinePath,
      runDir,
      orientation,
      outputDir: outDir,
    });
    result.generated = { ok: true };
    result.snapshots = [
      { at: "mid", path: path.join(outDir, "snap-mid.png"), ok: false },
      { at: "end", path: path.join(outDir, "snap-end.png"), ok: false },
    ];
  } catch (e) {
    result.generated = { ok: false, error: (e as Error).message };
    return result;
  }

  // 2) check --strict（实测：失败退出码为 0，必须以 "Check failed" 标记为准）
  const check = await run(cli, [...cliBase, "check", "--strict"], outDir);
  const checkFailed = /check failed/i.test(check.output);
  result.check = { ok: check.exitCode === 0 && !checkFailed, exitCode: check.exitCode };
  if (check.exitCode !== 0 || checkFailed) {
    const log = path.join(runDir, "renders", compId + ".check.log");
    await writeErrorLog(log, check.output);
    result.check.errorLog = log;
    return result;
  }

  // 3) render 前 snapshot 中点/末点
  const mid = item.expectedDurationSec / 2;
  const end = Math.max(0, item.expectedDurationSec - 0.2);
  const snapMid = await run(cli, [...cliBase, "snapshot", "--at", mid.toFixed(2), "--output", result.snapshots[0].path], outDir);
  const snapEnd = await run(cli, [...cliBase, "snapshot", "--at", end.toFixed(2), "--output", result.snapshots[1].path], outDir);
  result.snapshots[0].ok = snapMid.exitCode === 0;
  result.snapshots[1].ok = snapEnd.exitCode === 0;

  // 4) render --quality（期望时长经环境变量传给 CLI，供离线 stub 生成等长片；真实 CLI 忽略）
  await mkdir(path.dirname(mp4Path), { recursive: true });
  const render = await run(
    cli,
    [...cliBase, "render", "--quality", item.quality, "--output", mp4Path],
    outDir,
    { ...process.env, HYPERFRAMES_RENDER_DURATION_SEC: String(item.expectedDurationSec) } as NodeJS.ProcessEnv
  );
  result.render = { ok: render.exitCode === 0, exitCode: render.exitCode };
  if (render.exitCode !== 0) {
    const log = path.join(runDir, "renders", compId + ".render.log");
    await writeErrorLog(log, render.output);
    result.render.errorLog = log;
    return result;
  }

  // 5) 产物统计 + ffprobe
  try {
    const st = await stat(mp4Path);
    result.render.bytes = st.size;
    result.render.mp4Path = path.relative(ROOT, mp4Path);
    result.render.sha256 = await sha256File(mp4Path);
  } catch {
    result.render.ok = false;
    result.render.errorLog = path.join(runDir, "renders", compId + ".render.log");
    await writeErrorLog(result.render.errorLog, "render 声称成功但 MP4 不存在：" + mp4Path);
    return result;
  }
  const probe = await ffprobeProbe(mp4Path);
  result.ffprobe = probe;
  if (probe.ok && probe.durationSec !== undefined) {
    result.render.durationSec = probe.durationSec;
    const tol = Math.max(1.0, item.expectedDurationSec * 0.15);
    if (Math.abs(probe.durationSec - item.expectedDurationSec) > tol) {
      result.ffprobe.ok = false;
      result.ffprobe.error =
        "时长偏差超容忍：" + probe.durationSec.toFixed(2) + "s vs 期望 " + item.expectedDurationSec + "s（tol " + tol.toFixed(2) + "s）";
    }
  }

  // 6) 可选整片 review（§4.5：check 通过 ≠ 成片通过；provider 不可用 → error）
  if (doReview) {
    const reportPath = path.join(runDir, "review", compId + ".json");
    const rev = await run("node", ["scripts/review-video.ts", "--video", mp4Path, "--out", reportPath], ROOT);
    result.review = {
      ok: rev.exitCode === 0,
      reportPath: rev.exitCode === 0 ? path.relative(ROOT, reportPath) : undefined,
      skipped: false,
      error: rev.exitCode === 0 ? undefined : rev.output.slice(0, 300),
    };
  }

  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const has = (flag: string) => args.includes(flag);

  const batchPath = path.resolve(ROOT, get("--batch", ""));
  if (!batchPath) {
    console.error("[hyperframes-batch] 必须提供 --batch <batch.json>");
    process.exit(1);
  }
  const concurrency = Math.max(1, Math.min(8, parseInt(get("--concurrency", "2"), 10) || 2));
  const doReview = has("--review");
  // CLI 可含空格（如 "npx hyperframes"）：拆成 cmd + 固定 base args
  const cliParts = (process.env.HYPERFRAMES_CLI ?? "npx hyperframes").split(/\s+/).filter(Boolean);
  const cli = cliParts.shift() ?? "hyperframes";
  const cliBase = cliParts;

  let batch: BatchItem[];
  try {
    batch = JSON.parse(await readFile(batchPath, "utf-8")) as BatchItem[];
  } catch (e) {
    console.error("[hyperframes-batch] 无法读取 batch.json：" + (e as Error).message);
    process.exit(1);
  }
  if (!Array.isArray(batch) || batch.length === 0) {
    console.error("[hyperframes-batch] batch.json 必须是非空数组");
    process.exit(1);
  }

  // job 并行池；单 job 内 orientations 顺序执行
  const results: JobResult[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, batch.length) }, async () => {
    while (cursor < batch.length) {
      const item = batch[cursor++];
      for (const orientation of item.orientations) {
        const r = await processOrientation(item, orientation, cli, cliBase, doReview);
        results.push(r);
        console.log(
          "[hyperframes-batch] " + r.compositionId + ": " +
            (r.generated.ok ? "gen✓" : "gen✗ " + r.generated.error) +
            " check=" + (r.check.ok ? "✓" : "✗(" + r.check.exitCode + ")") +
            " render=" + (r.render.ok ? "✓" : "✗(" + r.render.exitCode + ")") +
            (r.render.bytes !== undefined ? " " + r.render.bytes + "B" : "") +
            (r.render.durationSec !== undefined ? " " + r.render.durationSec.toFixed(2) + "s" : "") +
            " ffprobe=" + (r.ffprobe.ok ? "✓" : "✗")
        );
      }
      const allOk = item.orientations.every((o) => results.some((r) => r.compositionId === "hf-" + item.runId + "-" + o && r.render.ok && r.ffprobe.ok));
      if (allOk) {
        await markStageDone(item.runId, "render", {
          outputs: item.orientations.map((o) => "renders/hf-" + item.runId + "-" + o + ".mp4"),
        });
      }
    }
  });
  await Promise.all(workers);

  const resultPath = path.resolve(ROOT, get("--result", path.join(path.dirname(batchPath), "batch-result.json")));
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(resultPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    cli: cli + " " + cliBase.join(" "),
    concurrency,
    jobs: results,
    summary: {
      total: results.length,
      ok: results.filter((r) => r.generated.ok && r.check.ok && r.render.ok && r.ffprobe.ok).length,
      failed: results.filter((r) => !(r.generated.ok && r.check.ok && r.render.ok && r.ffprobe.ok)).length,
    },
  }, null, 2), "utf-8");

  console.log("[hyperframes-batch] 结果 → " + path.relative(ROOT, resultPath));
  const failed = results.filter((r) => !(r.generated.ok && r.check.ok && r.render.ok && r.ffprobe.ok));
  if (failed.length > 0) {
    console.error("[hyperframes-batch] " + failed.length + " 个组合失败（其他成功产物已保留），退出非零");
    process.exit(1);
  }
  console.log("[hyperframes-batch] 全部 " + results.length + " 个组合通过");
}

const isDirectRun =
  process.argv[1] &&
  (import.meta.url === new URL("file://" + path.resolve(process.argv[1])).href ||
    import.meta.url.endsWith("/" + path.basename(process.argv[1])));
if (isDirectRun) {
  main().catch((e) => {
    console.error("[hyperframes-batch] 失败:", e);
    process.exit(1);
  });
}
