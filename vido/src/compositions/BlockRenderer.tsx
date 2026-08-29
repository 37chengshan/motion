/**
 * BlockRenderer — 内容块分发器
 * 现状：仅 8 个文字/终端/手绘组件已接入（Typewriter/Stagger/Blur/Terminal/Code/List/HandDrawing/CharacterProgress + Comparison/StatCounter），见 docs/effects.md §一 ✅
 * 缺口：docs/effects.md 曾列 55 项，含运镜（KenBurns/Dolly/Beat/FlowArrow）与AI生图（diagrams/milvus/*）均为 ⏳ 规划，非实现；已在 VIDO.md §五与 docs/effects.md §零 按 ✅/📦/⏳/📋 标注，避免文档与代码割裂
 * 约定：Milvus 天花板三轨（A-AI底图 visual_prompt / B-代码图 diagram_spec / C-运镜 camera/reveal）待 M 任务新增，不在本文件批量实现
 */
import React from "react";
import { AbsoluteFill } from "remotion";
import type { VideoBlock, VideoConfig } from "../data/types";
import { TypewriterEffect } from "../components/effects/TypewriterEffect";
import { StaggerText } from "../components/effects/StaggerText";
import { BlurText } from "../components/effects/BlurText";
import { TerminalTypewriter } from "../components/effects/TerminalTypewriter";
import { HandDrawing, handDrawingPaths } from "../components/effects/HandDrawing";
import { CodeBlock } from "../components/effects/CodeBlock";
import { ListBlock } from "../components/effects/ListBlock";
import { useStyle } from "./styles/StyleProvider";

interface Props {
  block: VideoBlock;
  config: VideoConfig;
  index: number;
}

/** 内容卡片容器：圆角+毛玻璃+阴影，提升排版层次 */
const Card: React.FC<{ children: React.ReactNode; pad?: number }> = ({
  children,
  pad = 56,
}) => {
  const { theme } = useStyle();
  return (
    <div
      style={{
        background: `${theme.panel}cc`,
        borderRadius: 24,
        padding: pad,
        boxShadow: "0 16px 48px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)",
        border: `1px solid ${theme.muted}22`,
        maxWidth: "100%",
        backdropFilter: "blur(8px)",
      }}
    >
      {children}
    </div>
  );
};

/**
 * 内容块渲染器：根据 block.type + effect 分发到对应效果组件
 */
export const BlockRenderer: React.FC<Props> = ({ block, config }) => {
  const { theme, orientation } = useStyle();
  const titleSize = orientation === "short" ? 84 : 120;

  switch (block.type) {
    case "title":
      return (
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            padding: 40,
          }}
        >
          <div style={{ position: "relative" }}>
            <StaggerText
              text={block.content}
              fontSize={titleSize}
              color={theme.text}
              accent={theme.accent}
              fontFamily={theme.titleFont}
              subtitle={config.subtitle}
            />
            {/* 标题底部强调线 */}
            <div
              style={{
                position: "absolute",
                bottom: -28,
                left: "50%",
                transform: "translateX(-50%)",
                width: "56%",
                height: 5,
                borderRadius: 3,
                background: `linear-gradient(90deg, transparent, ${theme.accent}, transparent)`,
              }}
            />
          </div>
        </AbsoluteFill>
      );

    case "text":
      return (
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            padding: 60,
          }}
        >
          {block.effect === "stagger" ? (
            <StaggerText
              text={block.content}
              fontSize={orientation === "short" ? 56 : 80}
              color={theme.text}
              accent={theme.accent}
              fontFamily={theme.fontFamily}
            />
          ) : (
            <BlurText
              text={block.content}
              fontSize={orientation === "short" ? 56 : 80}
              color={theme.text}
              fontFamily={theme.fontFamily}
            />
          )}
        </AbsoluteFill>
      );

    case "list":
      return (
        <AbsoluteFill
          style={{
            justifyContent: "center",
            padding: 60,
          }}
        >
          <Card>
            <ListBlock items={block.items ?? []} />
          </Card>
        </AbsoluteFill>
      );

    case "code":
      return (
        <AbsoluteFill
          style={{ justifyContent: "center", padding: 60 }}
        >
          <Card pad={24}>
            <CodeBlock
              code={block.content}
              language={block.language ?? "bash"}
            />
          </Card>
        </AbsoluteFill>
      );

    case "terminal":
      return (
        <AbsoluteFill
          style={{ justifyContent: "center", padding: 60 }}
        >
          <TerminalTypewriter content={block.content} />
        </AbsoluteFill>
      );

    case "hand-drawing":
      return (
        <AbsoluteFill
          style={{ justifyContent: "center", alignItems: "center", padding: 40 }}
        >
          <HandDrawing
            svgPath={block.svgPath ?? handDrawingPaths.trendLine}
            label={block.content}
            strokeColor={theme.accent}
          />
        </AbsoluteFill>
      );

    case "image":
      return (
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            padding: 40,
          }}
        >
          {block.src ? (
            <img
              src={block.src}
              alt={block.content}
              style={{
                maxWidth: "90%",
                maxHeight: "80%",
                objectFit: "contain",
                borderRadius: 16,
                boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
              }}
            />
          ) : (
            <div style={{ color: theme.muted, fontSize: 32 }}>
              图片: {block.content}
            </div>
          )}
        </AbsoluteFill>
      );

    case "video":
      return (
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            padding: 40,
            backgroundColor: "#000",
          }}
        >
          <div style={{ color: "#fff", fontSize: 32 }}>
            视频: {block.content}
          </div>
        </AbsoluteFill>
      );

    case "chart":
      return (
        <AbsoluteFill
          style={{ justifyContent: "center", padding: 60 }}
        >
          <div style={{ color: theme.muted, fontSize: 32 }}>
            图表: {block.content}
          </div>
        </AbsoluteFill>
      );

    default:
      return (
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div style={{ color: theme.text, fontSize: 48 }}>{block.content}</div>
        </AbsoluteFill>
      );
  }
};
