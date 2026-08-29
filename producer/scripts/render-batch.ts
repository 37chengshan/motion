/**
 * Remotion 数据集渲染器（§5.2 重构版）
 *
 * 读取 weekly/batch.json（或 --batch 指定），一次 bundle 后对每个 job 复用同一 bundle：
 *   selectComposition({ id, inputProps }) + renderMedia({ inputProps })
 * 输出：每个 run 的 renders/short.mp4（VidoShort）与 renders/long.mp4（VidoLong）。
 * Props 契约：RenderJobProps（§5.1），全部 JSON 可序列化；禁止文件句柄/函数/绝对路径。
 * 音频：timeline 中的 audioPath 复制到 public/voiceover/<runId>/<i>.wav，
 *       inputProps.voiceoverRoot="voiceover/<runId>"（public/ 子目录，gitignored，不跨 run 覆盖）。
 *
 * batch.json 项：
 *   { runId, configPath, timelinePath, runDir?, orientations?: ["short","long"], fps? }
 *
 * 用法：
 *   node scripts/render-batch.ts --batch weekly/batch.json [--entry src/index.ts] [--concurrency 1]
 * 离线验证：导出 prepareRenderJobs(batchPath) 返回 { jobs, copies }，不触发 Chromium。
 */
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "node:path";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { RenderJobProps, TimelineDto } from "../src/data/renderJob.ts";
import type { VideoConfig } from "../src/data/types.ts";
import { markStageDone } from "./stage.ts";

const ROOT = process.cwd();

export interface WeeklyBatchItem {
  runId: string;
  configPath: string;
  timelinePath: string;
  runDir?: string;
  orientations?: ("short" | "long")[];
  fps?: number;
}

export interface PreparedRenderJob {
  runId: string;
  compositionId: "VidoShort" | "VidoLong";
  orientation: "short" | "long";
  inputProps: RenderJobProps;
  outputLocation: string;
}

export interface PreparedBatch {
  jobs: PreparedRenderJob[];
  /** 需要从 run 音频目录复制到 public/voiceover/<runId>/ 的文件 */
  copies: { from: string; to: string }[];
}

interface TimelineRaw {
  fps: number;
  totalFrames: number;
  entries: { blockIndex: number; audioPath: string | null; targetFrames: number; globalStartSec: number; audioDurationSec: number }[];
}

/** §5.2 只做数据准备（离线可测）：读 batch.json → 构建 inputProps/输出路径/音频复制清单 */
export async function prepareRenderJobs(batchPath: string): Promise<PreparedBatch> {
  const abs = path.resolve(ROOT, batchPath);
  const items = JSON.parse(await readFile(abs, "utf-8")) as WeeklyBatchItem[];
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("batch.json 必须是非空数组");
  }
  const jobs: PreparedRenderJob[] = [];
  const copies: { from: string; to: string }[] = [];

  for (const item of items) {
    if (!item.runId || !item.configPath || !item.timelinePath) {
      throw new Error("batch 项缺少 runId/configPath/timelinePath：" + JSON.stringify(item));
    }
    const runDir = path.resolve(ROOT, item.runDir ?? path.dirname(path.dirname(item.configPath)));
    const config = JSON.parse(await readFile(path.resolve(ROOT, item.configPath), "utf-8")) as VideoConfig;
    const rawTimeline = JSON.parse(await readFile(path.resolve(ROOT, item.timelinePath), "utf-8")) as TimelineRaw;
    const fps = item.fps ?? rawTimeline.fps ?? 30;
    const timeline: TimelineDto = {
      entries: rawTimeline.entries.map((e) => ({
        blockIndex: e.blockIndex,
        audioPath: e.audioPath,
        audioDurationSec: e.audioDurationSec,
        targetFrames: e.targetFrames,
        globalStartSec: e.globalStartSec,
      })),
      totalFrames: rawTimeline.totalFrames,
      fps,
    };
    const voiceoverRoot = "voiceover/" + item.runId;

    // 音频复制清单（仅复制 timeline 声明有音频的段）
    for (const e of timeline.entries) {
      if (!e.audioPath) continue;
      const from = path.resolve(ROOT, e.audioPath);
      const to = path.join(ROOT, "public", voiceoverRoot, e.blockIndex + ".wav");
      copies.push({ from, to });
    }

    for (const orientation of item.orientations ?? ["short", "long"]) {
      const inputProps: RenderJobProps = {
        config,
        timeline,
        voiceoverRoot,
        runId: item.runId,
      };
      // JSON 可序列化校验（禁止函数/句柄/绝对路径进 Chrome）
      const roundtrip = JSON.parse(JSON.stringify(inputProps)) as RenderJobProps;
      if (!roundtrip.config || roundtrip.config.type !== config.type) {
        throw new Error("inputProps 不可 JSON 序列化：" + item.runId);
      }
      jobs.push({
        runId: item.runId,
        compositionId: orientation === "short" ? "VidoShort" : "VidoLong",
        orientation,
        inputProps,
        outputLocation: path.join(runDir, "renders", orientation + ".mp4"),
      });
    }
  }
  return { jobs, copies };
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const batchPath = get("--batch", "weekly/batch.json");
  const entry = path.resolve(ROOT, get("--entry", "src/index.ts"));
  const outResult = get("--result", path.join(path.dirname(batchPath), "render-batch-result.json"));

  const { jobs, copies } = await prepareRenderJobs(batchPath);

  // 复制音频到 public/voiceover/<runId>/（public 子目录，gitignored）
  for (const c of copies) {
    if (!existsSync(c.from)) {
      console.error("[render-batch] 音频缺失：" + c.from + "（先跑 prepare-audio）");
      process.exit(1);
    }
    await mkdir(path.dirname(c.to), { recursive: true });
    await copyFile(c.from, c.to);
  }

  console.log("[render-batch] 打包项目（一次 bundle）…");
  const serveUrl = await bundle({
    entryPoint: entry,
    onProgress: (p) => {
      if (p % 25 === 0) console.log("  打包进度 " + p + "%");
    },
  });

  const results: { runId: string; compositionId: string; orientation: string; ok: boolean; outputLocation: string }[] = [];
  for (const job of jobs) {
    console.log("[render-batch] 渲染 " + job.compositionId + "（" + job.runId + "）→ " + path.relative(ROOT, job.outputLocation));
    try {
      const composition = await selectComposition({
        serveUrl,
        id: job.compositionId,
        inputProps: job.inputProps as unknown as Record<string, unknown>,
      });
      await renderMedia({
        composition,
        serveUrl,
        codec: "h264",
        outputLocation: job.outputLocation,
        inputProps: job.inputProps as unknown as Record<string, unknown>,
      });
      results.push({ runId: job.runId, compositionId: job.compositionId, orientation: job.orientation, ok: true, outputLocation: path.relative(ROOT, job.outputLocation) });
    } catch (e) {
      console.error("[render-batch] " + job.compositionId + " 失败：" + (e as Error).message);
      results.push({ runId: job.runId, compositionId: job.compositionId, orientation: job.orientation, ok: false, outputLocation: path.relative(ROOT, job.outputLocation) });
    }
  }

  await mkdir(path.dirname(path.resolve(ROOT, outResult)), { recursive: true });
  await writeFile(path.resolve(ROOT, outResult), JSON.stringify({
    generated_at: new Date().toISOString(),
    jobs: results,
    summary: { total: results.length, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length },
  }, null, 2), "utf-8");

  // 每 run 全部 orientation 成功 → stage render done
  for (const job of jobs) {
    const all = jobs.filter((j) => j.runId === job.runId);
    const allOk = all.every((j) => results.find((r) => r.runId === j.runId && r.orientation === j.orientation)?.ok);
    if (allOk) {
      await markStageDone(job.runId, "render", {
        outputs: all.map((j) => path.relative(ROOT, j.outputLocation)),
      });
    }
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error("[render-batch] " + failed.length + " 个渲染失败，退出非零");
    process.exit(1);
  }
  console.log("[render-batch] 全部 " + results.length + " 个产物完成 → " + outResult);
}

const isDirectRun =
  process.argv[1] &&
  (import.meta.url === new URL("file://" + path.resolve(process.argv[1])).href ||
    import.meta.url.endsWith("/" + path.basename(process.argv[1])));
if (isDirectRun) {
  main().catch((e) => {
    console.error("[render-batch] 失败:", e);
    process.exit(1);
  });
}