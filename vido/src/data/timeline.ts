// Timeline Manifest — 唯一时间事实源（双引擎共用）
//
// 生成方：scripts/prepare-audio.ts（TTS 合成后，读取每段 wav 时长生成）
// 消费方：
//  - Remotion：calculateMetadata 计算总时长 + Sequence durationInFrames
//  - HyperFrames：换算为 data-start / data-duration 属性（秒）
//  - scripts/gen-srt.ts：字幕时间轴
//  - 质检 proof frames：抽帧时间戳
// 四处共用同一份数据，杜绝音画/字幕/抽帧错位。

export interface TimelineEntry {
  /** 对应 today.json 的 block 索引 */
  blockIndex: number;
  /** 分段配音文件路径（相对项目根，如 "out/voiceover/0.wav"）；无配音为 null */
  audioPath: string | null;
  /** 该段音频时长（秒）；无音频时为估算值 */
  audioDurationSec: number;
  /** 该 block 目标持续帧数（fps 下） */
  targetFrames: number;
  /** block 结束后的静音缓冲（秒） */
  silenceAfterSec: number;
  /** 该 block 在全片中的起始帧 */
  globalStartFrame: number;
  /** 该 block 在全片中的起始秒（HyperFrames / SRT 用） */
  globalStartSec: number;
  /** 抽帧审查时间戳（秒，取该 block 中段） */
  proofTimestamps: number[];
}

export interface TimelineManifest {
  /** 生成时间（ISO） */
  generatedAt: string;
  /** 帧率 */
  fps: number;
  /** 全片总帧数 */
  totalFrames: number;
  /** 全片总时长（秒） */
  totalDurationSec: number;
  /** 无配音 block 的默认时长（秒） */
  defaultBlockSec: number;
  /** 每段尾部的缓冲帧数 */
  tailBufferFrames: number;
  /** 分段时间轴 */
  entries: TimelineEntry[];
}

/** 帧数 <-> 秒 换算（HyperFrames data-* 属性用秒，Remotion 用帧） */
export const framesToSec = (frames: number, fps: number): number => frames / fps;
export const secToFrames = (sec: number, fps: number): number => Math.round(sec * fps);

/** 读取 timeline.json（渲染侧/脚本侧通用；文件不存在返回 null） */
export const loadTimeline = async (
  path: string
): Promise<TimelineManifest | null> => {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as TimelineManifest;
  } catch {
    return null;
  }
};
