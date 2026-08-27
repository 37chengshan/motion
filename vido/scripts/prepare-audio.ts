/**
 * 音频时间轴生成脚本 — probe-first（ffprobe 逐段读时长）→ timeline.json
 *
 * timeline.json 是唯一时间事实源，四处消费：
 *  - Remotion：calculateMetadata 总时长 + Sequence durationInFrames
 *  - HyperFrames：data-start / data-duration 秒属性
 *  - gen-srt.ts：字幕时间轴
 *  - proof frames：抽帧审查时间戳
 *
 * 规则：
 *  - 有配音的 block：targetFrames = 音频秒数 × fps + 尾部缓冲
 *  - 无配音的 block：defaultBlockSec × fps（title/过渡类稍短）
 *  - globalStartFrame 顺序累加；proofTimestamps 取每段中段
 *
 * 用法：node scripts/prepare-audio.ts [--config src/data/today.json] [--fps 30]
 * 输出：out/timeline.json
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();

interface VideoBlockLite {
  type?: string;
  narration?: string;
}

/** ffprobe 读媒体时长（秒） */
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
    return i >= 0 ? args[i + 1] : fallback;
  };
  const configPath = path.resolve(ROOT, get("--config", "src/data/today.json"));
  const fps = parseInt(get("--fps", "30"), 10);
  const voiceoverDir = path.resolve(ROOT, "out", "voiceover");
  const outPath = path.resolve(ROOT, "out", "timeline.json");

  const config = JSON.parse(await readFile(configPath, "utf-8")) as {
    blocks: VideoBlockLite[];
  };
  const blocks = config.blocks ?? [];

  const defaultBlockSec = 3.5; // 无旁白 block 默认时长
  const titleBlockSec = 2.8; // 标题/开场稍短
  const tailBufferFrames = 15; // 每段尾部缓冲

  const entries: import("../src/data/timeline.js").TimelineEntry[] = [];
  let cursorFrame = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const wav = path.join(voiceoverDir, `${i}.wav`);
    const hasAudio = existsSync(wav) && (block.narration ?? "").trim().length > 0;

    let audioDurationSec: number;
    let audioPath: string | null = null;

    if (hasAudio) {
      const d = await probeDurationSec(wav);
      if (d === null) {
        console.warn(`[timeline] 第 ${i} 段 ffprobe 失败，用默认时长`);
        audioDurationSec = defaultBlockSec;
      } else {
        audioDurationSec = d;
        audioPath = path.relative(ROOT, wav).replace(/\\/g, "/");
        // 同步到 public/voiceover/（Remotion staticFile 消费）
        const pubDir = path.resolve(ROOT, "public", "voiceover");
        await mkdir(pubDir, { recursive: true });
        await copyFile(wav, path.join(pubDir, `${i}.wav`)).catch(() => {});
      }
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
  // 同步到 public/（Remotion calculateMetadata 在 Chrome 里 fetch staticFile 用）
  const pubTimeline = path.resolve(ROOT, "public", "timeline.json");
  await mkdir(path.dirname(pubTimeline), { recursive: true });
  await writeFile(pubTimeline, JSON.stringify(manifest, null, 2), "utf-8");

  const narrated = entries.filter((e) => e.audioPath).length;
  console.log(
    `[timeline] ${entries.length} 段（含配音 ${narrated}）总时长 ${manifest.totalDurationSec}s（${cursorFrame} 帧 @${fps}fps）→ out/timeline.json`
  );
  console.log("[timeline] 下一步：渲染（Remotion calculateMetadata / HyperFrames data-*）或 node scripts/gen-srt.ts");
}

main().catch((e) => {
  console.error("[timeline] 失败:", e);
  process.exit(1);
});
