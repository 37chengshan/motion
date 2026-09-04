import React from "react";
import { AbsoluteFill, Audio, Series, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { VideoConfig } from "../data/types";
import type { RenderJobProps } from "../data/renderJob";
import { EMPTY_CONFIG } from "../data/renderJob";
import { CharacterProgressBar } from "../components/effects/CharacterProgressBar";
import { BgmAudio } from "../components/effects/BgmAudio";
import { BlockRenderer } from "./BlockRenderer";
import { ProjectSpotlight } from "../components/templates/ProjectSpotlight";
import { StyleProvider } from "./styles/StyleProvider";

export type TimelineEntries = {
  blockIndex: number;
  audioPath: string | null;
  targetFrames: number;
  globalStartSec: number;
  audioDurationSec: number;
}[];

type Props = RenderJobProps;

/** 按 timeline 计算每 block 帧数（无 timeline 时回退默认时长） */
const framesFor = (
  config: VideoConfig,
  timelineEntries: TimelineEntries | undefined,
  i: number
): number => {
  if (timelineEntries && timelineEntries[i]) {
    return Math.max(30, timelineEntries[i].targetFrames);
  }
  return config.blocks[i]?.type === "title" ? 75 : 90;
};

/**
 * 竖屏 1080×1920 (9:16) — 抖音 / 小红书
 * template 路由：project-spotlight → 科普模板；默认 → Series+BlockRenderer
 * 音画同步：timeline.json 事实源驱动 Sequence 时长 + 每段旁白 Audio
 */
export const VidoShort: React.FC<Props> = (props) => {
  const config = props.config ?? EMPTY_CONFIG;
  const timelineEntries = props.timeline?.entries;
  const voiceoverRoot = props.voiceoverRoot;
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const hasTimeline =
    timelineEntries && timelineEntries.length === config.blocks.length ? timelineEntries : undefined;

  return (
    <AbsoluteFill style={{ backgroundColor: "#fff" }}>
      {/* BGM 铺底 + 旁白闪避（config.bgm 指定且 timeline 存在时启用） */}
      {config.bgm && hasTimeline ? (
        <BgmAudio src={config.bgm} entries={hasTimeline} />
      ) : null}
      <StyleProvider style={config.style} orientation="short">
        {config.template === "project-spotlight" ? (
          <ProjectSpotlight config={config} timelineEntries={hasTimeline} fps={30} />
        ) : (
          <AbsoluteFill style={{ padding: 80, paddingBottom: 140 }}>
            <Series>
              {config.blocks.map((block, i) => {
                const frames = framesFor(config, hasTimeline, i);
                const audio =
                  hasTimeline && hasTimeline[i].audioPath
                    ? staticFile(voiceoverRoot ? voiceoverRoot + "/" + i + ".wav" : `voiceover/${i}.wav`)
                    : null;
                return (
                  <Series.Sequence key={i} durationInFrames={frames}>
                    <>
                      <BlockRenderer block={block} config={config} index={i} />
                      {audio ? <Audio src={audio} /> : null}
                    </>
                  </Series.Sequence>
                );
              })}
            </Series>
          </AbsoluteFill>
        )}
        <CharacterProgressBar
          character={config.character ?? "cat"}
          progress={frame / durationInFrames}
          label={config.title}
        />
      </StyleProvider>
    </AbsoluteFill>
  );
};