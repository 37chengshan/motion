import React from "react";
import { AbsoluteFill, Series, Audio, staticFile, useVideoConfig } from "remotion";
import type { VideoBlock, VideoConfig } from "../../data/types";
import { useStyle } from "../../compositions/styles/StyleProvider";
import { StaggerText } from "../effects/StaggerText";
import { ListBlock } from "../effects/ListBlock";
import { TerminalTypewriter } from "../effects/TerminalTypewriter";
import { HandDrawing, handDrawingPaths } from "../effects/HandDrawing";
import { StatCounter } from "../effects/StatCounter";
import { ComparisonCard } from "../effects/ComparisonCard";
import { ProgressSteps } from "../effects/ProgressSteps";

type TimelineEntries = {
  blockIndex: number;
  audioPath: string | null;
  targetFrames: number;
  globalStartSec: number;
  audioDurationSec: number;
}[];

type Props = {
  config: VideoConfig;
  timelineEntries?: TimelineEntries;
  fps: number;
};

/** 解析 highlight 中的数字（如 "12.3k stars" → {value: 12300, label:"k"} 化前的原样展示） */
const parseHighlightNumber = (highlight?: string): { value: number; label: string } | null => {
  if (!highlight) return null;
  const m = highlight.match(/([\d,.]+)\s*(k|万|m)?/i);
  if (!m) return { value: 0, label: highlight };
  let value = parseFloat(m[1].replace(/,/g, ""));
  const unit = m[2]?.toLowerCase();
  if (unit === "k") value *= 1000;
  if (unit === "m") value *= 1_000_000;
  if (unit === "万") value *= 10_000;
  return { value: Math.round(value), label: highlight };
};

/** 文字介绍模块：标题 + 段落（信息主体） */
const TextIntro: React.FC<{ title?: string; text: string; compact?: boolean }> = ({
  title,
  text,
  compact,
}) => {
  const { theme, orientation } = useStyle();
  const tSize = orientation === "short" ? 40 : 52;
  const bSize = orientation === "short" ? (compact ? 26 : 30) : 34;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: compact ? 10 : 16,
        width: "100%",
        textAlign: "left",
      }}
    >
      {title ? (
        <div
          style={{
            fontSize: tSize,
            fontWeight: 700,
            color: theme.text,
            fontFamily: theme.titleFont,
          }}
        >
          {title}
        </div>
      ) : null}
      <div
        style={{
          fontSize: bSize,
          color: theme.muted,
          lineHeight: 1.6,
          background: `${theme.panel}cc`,
          borderRadius: 18,
          padding: compact ? "14px 20px" : "20px 28px",
        }}
      >
        {text}
      </div>
    </div>
  );
};

/** 数据卡模块（label/value 网格） */
const StatsGrid: React.FC<{ stats: { label: string; value: string }[] }> = ({ stats }) => {
  const { theme, orientation } = useStyle();
  const vSize = orientation === "short" ? 34 : 44;
  const lSize = orientation === "short" ? 20 : 26;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${orientation === "short" ? 120 : 150}px, 1fr))`,
        gap: 14,
        width: "100%",
      }}
    >
      {stats.map((s, i) => (
        <div
          key={i}
          style={{
            background: `${theme.panel}`,
            border: `1px solid ${theme.muted}22`,
            borderRadius: 16,
            padding: "16px 14px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: vSize, fontWeight: 800, color: theme.accent, fontFamily: "monospace" }}>
            {s.value}
          </div>
          <div style={{ fontSize: lSize, color: theme.muted, marginTop: 6 }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
};

/** 要点模块（圆点列表） */
const PointsBlock: React.FC<{ points: string[] }> = ({ points }) => {
  const { theme, orientation } = useStyle();
  const size = orientation === "short" ? 26 : 32;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
      {points.map((p, i) => (
        <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: theme.accent,
              flexShrink: 0,
              marginTop: size * 0.45,
            }}
          />
          <div style={{ fontSize: size, color: theme.text, lineHeight: 1.5 }}>{p}</div>
        </div>
      ))}
    </div>
  );
};

/** 开场钩子页：项目名 + desc 定位 + summary 介绍 + star 滚动 */
const HookPage: React.FC<{ block: VideoBlock; config: VideoConfig }> = ({ block, config }) => {
  const { theme, orientation } = useStyle();
  const size = orientation === "short" ? 72 : 96;
  const stat = parseHighlightNumber(block.highlight);
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: orientation === "short" ? 70 : 90,
        gap: orientation === "short" ? 36 : 44,
      }}
    >
      <StaggerText
        text={block.content}
        fontSize={size}
        color={theme.text}
        accent={theme.accent}
        fontFamily={theme.titleFont}
      />
      {config.subtitle ? (
        <div
          style={{
            fontSize: size * 0.36,
            color: theme.accent,
            fontWeight: 600,
            textAlign: "center",
            maxWidth: "90%",
            lineHeight: 1.5,
          }}
        >
          {config.subtitle}
        </div>
      ) : null}
      {block.summary ? <TextIntro text={block.summary} /> : null}
      {stat && stat.value > 0 ? (
        <StatCounter value={stat.value} label={stat.label} fontSize={orientation === "short" ? 84 : 104} />
      ) : null}
    </AbsoluteFill>
  );
};

/** 问题对比页：没有它 vs 有它 + 文字介绍 */
const ProblemPage: React.FC<{ block: VideoBlock }> = ({ block }) => {
  const items = block.items ?? [];
  return (
    <AbsoluteFill style={{ justifyContent: "center", padding: 70, gap: 40 }}>
      {block.summary ? <TextIntro text={block.summary} /> : null}
      <ComparisonCard
        before={{ title: "没有它", desc: items[0] ?? "" }}
        after={{ title: "有它", desc: items[1] ?? "" }}
      />
    </AbsoluteFill>
  );
};

/** 特性页：标题 + 介绍 + 特性列表 */
const FeaturesPage: React.FC<{ block: VideoBlock }> = ({ block }) => (
  <AbsoluteFill style={{ justifyContent: "center", padding: 70, gap: 36 }}>
    {block.summary ? <TextIntro text={block.summary} /> : null}
    <ListBlock items={block.items ?? []} />
  </AbsoluteFill>
);

/** 架构页：手绘 + 文字介绍 */
const ArchitecturePage: React.FC<{ block: VideoBlock }> = ({ block }) => {
  const { theme, orientation } = useStyle();
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: 60,
        gap: 36,
      }}
    >
      <HandDrawing
        svgPath={block.svgPath ?? handDrawingPaths.trendLine}
        label={block.content}
        strokeColor={theme.accent}
      />
      {block.summary ? (
        <div style={{ maxWidth: orientation === "short" ? "88%" : "70%" }}>
          <TextIntro text={block.summary} compact />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/** 上手页：终端真实命令 + 说明文字 */
const HandsOnPage: React.FC<{ block: VideoBlock }> = ({ block }) => (
  <AbsoluteFill style={{ justifyContent: "center", padding: 80, gap: 32 }}>
    <TerminalTypewriter content={block.content} />
    {block.summary ? <TextIntro text={block.summary} compact /> : null}
  </AbsoluteFill>
);

/** 数据收尾页：标题 + 数据卡 + 要点 + 链接 */
const OutroPage: React.FC<{ block: VideoBlock }> = ({ block }) => {
  const { theme, orientation } = useStyle();
  const stat = parseHighlightNumber(block.highlight);
  const size = orientation === "short" ? 52 : 68;
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: 70,
        gap: 30,
      }}
    >
      <StaggerText text={block.content} fontSize={size} color={theme.text} fontFamily={theme.titleFont} />
      {block.summary ? <TextIntro text={block.summary} compact /> : null}
      {(block.stats?.length ?? 0) > 0 ? <StatsGrid stats={block.stats!} /> : null}
      {stat && stat.value > 0 ? (
        <StatCounter value={stat.value} label={block.highlight ?? ""} fontSize={orientation === "short" ? 72 : 92} />
      ) : null}
      {block.points?.length ? <PointsBlock points={block.points} /> : null}
      {block.url ? (
        <div
          style={{
            fontSize: size * 0.4,
            color: theme.accent,
            fontFamily: "monospace",
            opacity: 0.9,
            wordBreak: "break-all",
            textAlign: "center",
          }}
        >
          {block.url}
        </div>
      ) : null}
      {block.source ? (
        <div style={{ fontSize: size * 0.32, color: theme.muted, letterSpacing: 2 }}>{block.source}</div>
      ) : null}
    </AbsoluteFill>
  );
};

/** 步骤总览页：3 步走 */
const StepsPage: React.FC<{ block: VideoBlock }> = ({ block }) => (
  <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 70, gap: 36 }}>
    {block.summary ? <TextIntro text={block.summary} /> : null}
    <ProgressSteps steps={block.items ?? []} stepInterval={40} />
  </AbsoluteFill>
);

/** block → 科普页面路由 */
const SceneForBlock: React.FC<{ block: VideoBlock; config: VideoConfig }> = ({ block, config }) => {
  switch (block.type) {
    case "title":
      return <HookPage block={block} config={config} />;
    case "list":
      return block.section === "problem" ? <ProblemPage block={block} /> : <FeaturesPage block={block} />;
    case "hand-drawing":
      return <ArchitecturePage block={block} />;
    case "terminal":
    case "code":
      return <HandsOnPage block={block} />;
    case "chart":
      return <StepsPage block={block} />;
    case "text":
      return <OutroPage block={block} />;
    default:
      return <OutroPage block={block} />;
  }
};

/**
 * ProjectSpotlight — 开源项目科普模板（Remotion 引擎）
 *
 * 科普叙事：钩子（定位+介绍+star 滚动）→ 对比（有无它）→ 特性 → 架构手绘 → 真实命令 → 数据收尾
 * 文字是信息主体：summary/points/stats 全部文字展示，动画辅助
 * 时序：timeline.json 事实源驱动 Sequence 时长；每段挂旁白 Audio
 */
export const ProjectSpotlight: React.FC<Props> = ({ config, timelineEntries, fps }) => {
  const { durationInFrames } = useVideoConfig();
  const hasTimeline = timelineEntries && timelineEntries.length === config.blocks.length;

  const framesFor = (i: number): number => {
    if (hasTimeline && timelineEntries[i]) return Math.max(30, timelineEntries[i].targetFrames);
    return config.blocks[i].type === "title" ? 84 : 105;
  };

  return (
    <AbsoluteFill>
      <Series>
        {config.blocks.map((block, i) => {
          const frames = framesFor(i);
          const audio =
            hasTimeline && timelineEntries[i].audioPath ? staticFile(`voiceover/${i}.wav`) : null;
          return (
            <Series.Sequence key={i} durationInFrames={frames}>
              <>
                <SceneForBlock block={block} config={config} />
                {audio ? <Audio src={audio} /> : null}
              </>
            </Series.Sequence>
          );
        })}
      </Series>
      {fps ? null : null}
    </AbsoluteFill>
  );
};
