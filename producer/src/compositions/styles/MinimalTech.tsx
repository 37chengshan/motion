import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { useStyle } from "./StyleProvider";

/**
 * #1 极简科技 — 网格细线 + 双色光晕漂移 + 背景水印 + 装饰圆环
 * SwiftClip Apple Light Mode 规范：#f5f5f7 基调、克制光效、大量留白
 */
export const MinimalTechBackground: React.FC = () => {
  const { theme } = useStyle();
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // 光晕缓慢漂移（整片周期内 60px 往返，确定性）
  const t = frame / durationInFrames;
  const driftX = Math.sin(t * Math.PI * 2) * 60;
  const driftY = Math.cos(t * Math.PI * 2) * 30;

  return (
    <AbsoluteFill>
      {/* 网格细线（40px 间距，极低对比） */}
      <AbsoluteFill
        style={{
          backgroundImage: `
            linear-gradient(rgba(0,0,0,0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,0,0,0.025) 1px, transparent 1px)
          `,
          backgroundSize: "40px 40px",
        }}
      />
      {/* 顶部蓝色光晕（漂移） */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 70% 35% at ${50 + driftX / 6}% -8%, rgba(0,122,255,0.10), transparent 70%)`,
        }}
      />
      {/* 右下紫色光晕（反向漂移） */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 60% 30% at ${90 - driftX / 8}% 105%, rgba(175,82,222,0.07), transparent 70%)`,
        }}
      />
      {/* 背景大字水印 */}
      <div
        style={{
          position: "absolute",
          bottom: 120,
          right: -30,
          fontSize: 260,
          fontWeight: 800,
          fontFamily: theme.titleFont,
          color: theme.accent,
          opacity: 0.03,
          letterSpacing: -8,
          lineHeight: 1,
          userSelect: "none",
        }}
      >
        AI
      </div>
      {/* 右上装饰圆环 */}
      <svg
        style={{ position: "absolute", top: 80, right: 100, opacity: 0.15 }}
        width="160"
        height="160"
        viewBox="0 0 160 160"
      >
        <circle cx="80" cy="80" r="76" fill="none" stroke={theme.accent} strokeWidth="1" />
        <circle cx="80" cy="80" r="58" fill="none" stroke={theme.accent} strokeWidth="0.6" strokeDasharray="3 5" />
        <circle cx="80" cy="80" r="4" fill={theme.accent} />
      </svg>
      {/* 左侧渐变强调线 */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: "18%",
          width: 4,
          height: 220,
          background: `linear-gradient(180deg, ${theme.accent}, transparent)`,
          borderRadius: 2,
          opacity: 0.8,
        }}
      />
      {/* 底部细线收尾 */}
      <div
        style={{
          position: "absolute",
          bottom: 170,
          left: "8%",
          right: "8%",
          height: 1,
          background: `linear-gradient(90deg, transparent, ${theme.accent}44, transparent)`,
        }}
      />
    </AbsoluteFill>
  );
};
