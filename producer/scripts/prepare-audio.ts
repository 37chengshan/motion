/**
 * 音频时间轴生成脚本 — probe-first（ffprobe 逐段读时长）→ timeline.json
 *
 * timeline.json 是唯一时间事实源，四处消费：
 *  - Remotion：calculateMetadata 总时长 + Sequence durationInFrames
 *  - HyperFrames：data-start / data-duration 秒属性
 *  - gen-srt.ts：字幕时间轴
 *  - proof frames：抽帧审查时间戳
 *
 * run-dir 契约（计划 §2.5）：
 *   --run-dir runs/YYYY-MM-DD/<stream>-<edition>-<slug>
 *   输入默认来自 run 目录（config/content.json、audio/<i>.wav），
 *   输出统一 runs/<run>/timeline/timeline.json；不再读写 out/、public/ 单例。
 *   音频缺失、ffprobe 失败或 block/narration 数量不一致（孤儿 wav / 有旁白无音频）→ 直接失败，不静默降级。
 *
 * 用法：
 *   node scripts/prepare-audio.ts --run-dir runs/2026-08-28/ai-news-morning
 *   node scripts/prepare-audio.ts --run-dir <dir> [--config ...] [--voiceover-dir ...] [--timeline-out ...] [--fps 30]
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { TimelineEntry } from "../src/data/timeline.ts";
import { runDirPaths } from "../src/data/timeline.ts";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();

interface VideoBlockLite {
  type?: string;
  narration?: string;
}

/** ffprobe 读媒体时长（秒）；失败返回 null */
async function probeDurationSec(file: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      file,
    ]);
    const d = parseFloat(stdout.trim());
    return isNaN(d) ? null : d;
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };

  const runDirFlag = get("--run-dir", "");
  if (!runDirFlag) {
    console.error("[timeline] 必须提供 --run-dir（如 runs/2026-08-28/ai-news-morning）");
    process.exit(1);
  }
  const runDir = path.resolve(ROOT, runDirFlag);
  const runPaths = runDirPaths(runDir);

  // 默认输入/输出全部落在 run 目录内；显式 --config/--voiceover-dir/--timeline-out 可覆盖
  const configPath = path.resolve(ROOT, get("--config", runPaths.configPath));
  const fps = parseInt(get("--fps", "30"), 10);
  if (!Number.isInteger(fps) || fps <= 0) {
    console.error("[timeline] --fps 必须是正整数，收到：" + get("--fps", "30"));
    process.exit(1);
  }
  const voiceoverDir = path.resolve(ROOT, get("--voiceover-dir", runPaths.audioDir));
  const timelineOut = get("--timeline-out", "");
  const outPath = path.resolve(ROOT, timelineOut || runPaths.timelinePath);

  const config = JSON.parse(await readFile(configPath, "utf-8")) as {
    blocks: VideoBlockLite[];
  };
  const blocks = config.blocks ?? [];

  const defaultBlockSec = 3.5; // 无旁白 block 默认时长
  const titleBlockSec = 2.8; // 标题/开场稍短
  const tailBufferFrames = 15; // 每段尾部缓冲

  const entries: TimelineEntry[] = [];
  let cursorFrame = 0;
  let narrated = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const wav = path.join(voiceoverDir, `${i}.wav`);
    const needsNarration = (block.narration ?? "").trim().length > 0;

    // 契约 §2.5：有旁白就必须有音频；缺音频直接失败
    if (needsNarration && !existsSync(wav)) {
      console.error(`[timeline] 第 ${i} 段有 narration 但缺少音频：${wav}`);
      process.exit(1);
    }

    const hasAudio = needsNarration && existsSync(wav);

    let audioDurationSec: number;
    let audioPath: string | null = null;

    if (hasAudio) {
      const d = await probeDurationSec(wav);
      if (d === null) {
        // 契约 §2.5：ffprobe 失败必须失败，不用默认时长继续
        console.error(`[timeline] 第 ${i} 段 ffprobe 失败：${wav}`);
        process.exit(1);
      }
      audioDurationSec = d;
      audioPath = path.relative(ROOT, wav).replace(/\\/g, "/");
      narrated++;
    } else {
      audioDurationSec = block.type === "title" ? titleBlockSec : defaultBlockSec;
    }

    const targetFrames = Math.round(audioDurationSec * fps) + tailBufferFrames;
    const silenceAfterSec = tailBufferFrames / fps;
    const globalStartFrame = cursorFrame;
    const globalStartSec = globalStartFrame / fps;

    // 抽帧审查点：段中段 + 段尾前 0.3s
    const midSec = globalStartSec + (targetFrames / fps) * 0.55;
    const endSec = globalStartSec + targetFrames / fps - 0.3;

    entries.push({
      blockIndex: i,
      audioPath,
      audioDurationSec,
      targetFrames,
      silenceAfterSec,
      globalStartFrame,
      globalStartSec,
      proofTimestamps: [Number(midSec.toFixed(2)), Number(endSec.toFixed(2))],
    });

    cursorFrame += targetFrames;
  }

  // 契约 §2.5/2.7：block 与 narration/音频数量必须一致；孤儿 wav 或有旁白无音频都直接失败
  const wavFiles = (await readdir(voiceoverDir).catch(() => []))
    .filter((f) => /^\d+\.wav$/i.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const narratedIndexes = blocks
    .map((b, i) => ((b.narration ?? "").trim() ? i : -1))
    .filter((i) => i >= 0);
  for (const f of wavFiles) {
    const idx = parseInt(f, 10);
    if (!narratedIndexes.includes(idx)) {
      console.error(`[timeline] block/narration 数量不一致：音频 ${f} 对应第 ${idx} 段，但该段无 narration`);
      process.exit(1);
    }
  }
  if (narratedIndexes.length !== wavFiles.length) {
    console.error(
      `[timeline] block/narration 数量不一致：${narratedIndexes.length} 段有 narration，但 audio/ 下只有 ${wavFiles.length} 个 wav（应逐段一一对应）`
    );
    process.exit(1);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    fps,
    totalFrames: cursorFrame,
    totalDurationSec: Number((cursorFrame / fps).toFixed(2)),
    defaultBlockSec,
    tailBufferFrames,
    entries,
  };

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(manifest, null, 2), "utf-8");

  console.log(
    `[timeline] ${entries.length} 段（含配音 ${narrated}）总时长 ${manifest.totalDurationSec}s（${cursorFrame} 帧 @${fps}fps）→ ${outPath}`
  );
  console.log("[timeline] 下一步：渲染（Remotion calculateMetadata / HyperFrames data-*）或 node scripts/gen-srt.ts");
}

main().catch((e) => {
  console.error("[timeline] 失败:", e);
  process.exit(1);
});