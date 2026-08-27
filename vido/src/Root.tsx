import React from "react";
import { Composition, staticFile } from "remotion";
import { VidoShort, type TimelineEntries } from "./compositions/VidoShort";
import { VidoLong } from "./compositions/VidoLong";
import type { VideoConfig } from "./data/types";
import defaultConfig from "./data/today.json";

const FPS = 30;

interface TimelineMeta {
  entries: TimelineEntries;
  totalFrames: number;
  fps: number;
}

/** Chrome 端异步读 public/timeline.json（calculateMetadata 环境）；失败返回 null */
const fetchTimeline = async (): Promise<TimelineMeta | null> => {
  try {
    const res = await fetch(staticFile("timeline.json"));
    if (!res.ok) return null;
    const parsed = (await res.json()) as TimelineMeta;
    if (parsed?.entries?.length && parsed.totalFrames > 0) return parsed;
    return null;
  } catch {
    return null;
  }
};

type ShortProps = { config: VideoConfig; timelineEntries?: TimelineEntries };
type LongProps = ShortProps;

export const RemotionRoot: React.FC = () => {
  const config = defaultConfig as VideoConfig;

  // 有 timeline（音画同步事实源）用其总帧数；否则回退估算
  const fallbackDuration = Math.max(30, config.blocks.length * 90 + 120);

  // calculateMetadata：渲染前异步执行（Chrome 里 fetch public/ 静态文件）
  const calcShort = async ({ props }: { props: ShortProps }) => {
    const timeline = await fetchTimeline();
    if (!timeline) return {};
    return {
      durationInFrames: timeline.totalFrames,
      fps: timeline.fps,
      props: { ...props, timelineEntries: timeline.entries },
    };
  };

  const calcLong = async ({ props }: { props: LongProps }) => {
    const timeline = await fetchTimeline();
    if (!timeline) return {};
    return {
      durationInFrames: timeline.totalFrames,
      fps: timeline.fps,
      props: { ...props, timelineEntries: timeline.entries },
    };
  };

  return (
    <>
      <Composition
        id="VidoShort"
        component={VidoShort}
        durationInFrames={fallbackDuration}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={{ config }}
        calculateMetadata={calcShort}
      />
      <Composition
        id="VidoLong"
        component={VidoLong}
        durationInFrames={fallbackDuration}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{ config }}
        calculateMetadata={calcLong}
      />
    </>
  );
};
