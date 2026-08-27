import React from "react";
import { Audio, staticFile, useVideoConfig } from "remotion";

interface Entry {
  globalStartSec: number;
  targetFrames: number;
  /** 旁白实际时长（秒）；duck 区间仅覆盖它，尾缓冲内 BGM 回升 */
  audioDurationSec: number;
  audioPath: string | null;
}

interface Props {
  /** staticFile 相对路径（如 "bgm/bgm.mp3"） */
  src: string;
  /** timeline entries（含旁白段的起止） */
  entries: Entry[];
  /** 旁白段音量（duck 后） */
  duckVolume?: number;
  /** 间奏音量 */
  baseVolume?: number;
  /** 过渡时长（秒） */
  fadeSec?: number;
}

/**
 * BgmAudio — BGM 铺底 + 旁白闪避（ducking）
 *
 * 音量规则：旁白段内 duckVolume（0.15），段外 baseVolume（0.5），
 * 段边界 fadeSec 内线性过渡。帧驱动（volume 回调），渲染确定。
 */
export const BgmAudio: React.FC<Props> = ({
  src,
  entries,
  duckVolume = 0.15,
  baseVolume = 0.5,
  fadeSec = 0.35,
}) => {
  const { fps, durationInFrames } = useVideoConfig();

  const narrationSpans = entries
    .filter((e) => e.audioPath)
    .map((e) => ({
      start: e.globalStartSec,
      // duck 区间=旁白实际时长（尾缓冲 0.5s 留给 BGM 回升，避免全程压抑）
      end: e.globalStartSec + (e.audioDurationSec ?? 0),
    }));

  const volumeAt = (frame: number): number => {
    const t = frame / fps;
    let vol = baseVolume;
    for (const span of narrationSpans) {
      // 段内 → duck；进段前 fadeSec 与出段后 fadeSec 线性过渡
      if (t >= span.start - fadeSec && t <= span.start) {
        const k = (t - (span.start - fadeSec)) / fadeSec; // 0→1
        vol = Math.min(vol, baseVolume + (duckVolume - baseVolume) * k);
      } else if (t > span.start && t <= span.end) {
        vol = Math.min(vol, duckVolume);
      } else if (t > span.end && t <= span.end + fadeSec) {
        const k = (t - span.end) / fadeSec; // 0→1
        vol = Math.min(vol, duckVolume + (baseVolume - duckVolume) * k);
      }
    }
    return vol;
  };

  return (
    <Audio
      src={staticFile(src)}
      volume={(f) => volumeAt(f)}
      endAt={durationInFrames}
    />
  );
};
