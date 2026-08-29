import React from "react";
import { Composition } from "remotion";
import { VidoShort } from "./compositions/VidoShort";
import { VidoLong } from "./compositions/VidoLong";
import { EMPTY_CONFIG, type RenderJobProps } from "./data/renderJob";

const FPS = 30;

/**
 * Remotion Root — 完全由 RenderJobProps（inputProps）驱动（§5.1）
 * 不再 import src/data/today.json，不再 fetch public/timeline.json：
 * duration/fps 直接来自 props.timeline（render-batch 数据集渲染器传入）。
 */
export const RemotionRoot: React.FC = () => {
  const calc = async ({ props }: { props: Record<string, unknown> }) => {
    const job = props as RenderJobProps;
    const timeline = job.timeline;
    if (!timeline || !timeline.entries?.length || timeline.totalFrames <= 0) {
      return {};
    }
    return {
      durationInFrames: timeline.totalFrames,
      fps: timeline.fps,
      props: job as unknown as Record<string, unknown>,
    };
  };

  return (
    <>
      <Composition
        id="VidoShort"
        component={VidoShort}
        durationInFrames={30}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={{ config: EMPTY_CONFIG }}
        calculateMetadata={calc}
      />
      <Composition
        id="VidoLong"
        component={VidoLong}
        durationInFrames={30}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{ config: EMPTY_CONFIG }}
        calculateMetadata={calc}
      />
    </>
  );
};