/**
 * SRT 字幕生成脚本 — 从 timeline.json（唯一时间事实源）生成 out/subtitle.srt
 *
 * 字幕内容：today.json 各 block 的 narration（旁白即字幕）
 * 时间轴：与 block 的 globalStartSec/targetFrames 严格一致（同源杜绝错位）
 *
 * 用法：node scripts/gen-srt.ts
 * 输出：out/subtitle.srt（供 npm run render:burned 烧录 & B站外挂字幕）
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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
    return i >= 0 ? args[i + 1] : fallback;
  };
  const timelinePath = path.join(ROOT, get("--timeline", "out/timeline.json"));
  const configPath = path.join(ROOT, get("--config", "src/data/today.json"));
  const outPath = path.join(ROOT, get("--out", "out/subtitle.srt"));

  const timeline = JSON.parse(await readFile(timelinePath, "utf-8")) as TimelineManifest;
  const config = JSON.parse(await readFile(configPath, "utf-8")) as { blocks: VideoBlockLite[] };

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

  await writeFile(outPath, cues.join("\n"), "utf-8");
  console.log(`[srt] ${n} 条字幕 → ${path.relative(ROOT, outPath)}（时间轴与 timeline.json 同源）`);
}

main().catch((e) => {
  console.error("[srt] 失败:", e);
  process.exit(1);
});
