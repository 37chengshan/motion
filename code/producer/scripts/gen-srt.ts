/**
 * SRT 字幕生成脚本 — 从 timeline.json（唯一时间事实源）生成 runs/<run>/timeline/subtitle.srt
 *
 * 字幕内容：config 各 block 的 narration（旁白即字幕）
 * 时间轴：与 block 的 globalStartSec/targetFrames 严格一致（同源杜绝错位）
 *
 * run-dir 契约（计划 §2.5）：
 *   --run-dir runs/YYYY-MM-DD/<stream>-<edition>-<slug>
 *   默认从 run 目录读 timeline.json 与 config/content.json，输出 subtitle.srt。
 *   不再读写 out/ 单例。
 *
 * 用法：
 *   node scripts/gen-srt.ts --run-dir runs/2026-08-28/ai-news-morning
 *   node scripts/gen-srt.ts --run-dir <dir> [--timeline ...] [--config ...] [--out ...]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { runDirPaths } from "../src/data/timeline.ts";

const ROOT = process.cwd();

interface TimelineEntry {
  blockIndex: number;
  audioPath: string | null;
  audioDurationSec: number;
  targetFrames: number;
  globalStartSec: number;
}

interface TimelineManifest {
  fps: number;
  entries: TimelineEntry[];
}

interface VideoBlockLite {
  narration?: string;
  type?: string;
}

const fmtSrtTime = (sec: number): string => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
};

/** 长旁白拆成 ≤22 字的行（SRT 单行可读性） */
function wrapNarration(text: string, maxChars = 22): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return [clean];
  const lines: string[] = [];
  let cur = "";
  for (const ch of clean) {
    if (cur.length >= maxChars) {
      lines.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };

  const runDirFlag = get("--run-dir", "");
  if (!runDirFlag) {
    console.error("[srt] 必须提供 --run-dir（如 runs/2026-08-28/ai-news-morning）");
    process.exit(1);
  }
  const runDir = path.resolve(ROOT, runDirFlag);
  const runPaths = runDirPaths(runDir);

  const timelinePath = path.resolve(ROOT, get("--timeline", runPaths.timelinePath));
  const configPath = path.resolve(ROOT, get("--config", runPaths.configPath));
  const outPath = path.resolve(ROOT, get("--out", runPaths.subtitlePath));

  const timeline = JSON.parse(await readFile(timelinePath, "utf-8")) as TimelineManifest;
  const config = JSON.parse(await readFile(configPath, "utf-8")) as { blocks: VideoBlockLite[] };

  // 契约 §2.5：timeline 与 config 的 block 数必须一致，否则字幕错位，直接失败
  if (timeline.entries.length !== config.blocks.length) {
    console.error(
      `[srt] block/narration 数量不一致：timeline ${timeline.entries.length} 段 vs config ${config.blocks.length} 块`
    );
    process.exit(1);
  }

  const cues: string[] = [];
  let n = 0;

  for (const entry of timeline.entries) {
    const block = config.blocks[entry.blockIndex];
    const narration = (block?.narration ?? "").trim();
    if (!narration) continue;

    n++;
    const start = entry.globalStartSec;
    const end = start + entry.targetFrames / timeline.fps;
    const lines = wrapNarration(narration);
    cues.push(
      `${n}\n${fmtSrtTime(start)} --> ${fmtSrtTime(end)}\n${lines.join("\n")}\n`
    );
  }

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, cues.join("\n"), "utf-8");
  console.log(`[srt] ${n} 条字幕 → ${path.relative(ROOT, outPath)}（时间轴与 timeline.json 同源）`);
}

main().catch((e) => {
  console.error("[srt] 失败:", e);
  process.exit(1);
});