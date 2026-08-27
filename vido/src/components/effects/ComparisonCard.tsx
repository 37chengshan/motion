import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { useStyle } from "../../compositions/styles/StyleProvider";

interface Side {
  title: string;
  desc: string;
}

interface Props {
  /** 左侧（之前/没有它） */
  before: Side;
  /** 右侧（之后/有它） */
  after: Side;
}

/**
 * ComparisonCard — 前后对比卡（左右两栏依次入场，中间 VS 徽章弹入）
 * 参考 RVE comparison-chart 模式
 */
export const ComparisonCard: React.FC<Props> = ({ before, after }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { theme, orientation } = useStyle();
  const titleSize = orientation === "short" ? 40 : 52;
  const descSize = orientation === "short" ? 26 : 32;

  const enterLeft = spring({
    frame: frame - 5,
    fps,
    config: { damping: 14, stiffness: 120 },
  });
  const enterRight = spring({
    frame: frame - 18,
    fps,
    config: { damping: 14, stiffness: 120 },
  });
  const vsPop = spring({
    frame: frame - 30,
    fps,
    config: { damping: 9, stiffness: 220 },
  });
  const arrowOpacity = interpolate(frame, [40, 55], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const cardStyle = (enter: number, side: "before" | "after"): React.CSSProperties => ({
    flex: 1,
    padding: orientation === "short" ? 30 : 40,
    borderRadius: 20,
    background: side === "before" ? "#fafafa" : `${theme.accent}10`,
    border: side === "before" ? `2px solid ${theme.muted}55` : `2px solid ${theme.accent}88`,
    boxShadow:
      side === "after" ? `0 12px 40px ${theme.accent}26` : "0 8px 24px rgba(0,0,0,0.06)",
    transform: `translateY(${(1 - Math.max(enter, 0.001)) * 60}px)`,
    opacity: enter,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: orientation === "short" ? 20 : 28,
        fontFamily: theme.fontFamily,
        position: "relative",
      }}
    >
      {/* before 卡 */}
      <div style={cardStyle(enterLeft, "before")}>
        <div
          style={{
            fontSize: titleSize,
            fontWeight: 700,
            color: theme.muted,
            fontFamily: theme.titleFont,
          }}
        >
          {before.title}
        </div>
        <div style={{ fontSize: descSize, color: theme.muted, lineHeight: 1.5 }}>
          {before.desc}
        </div>
      </div>

      {/* 中间 VS 徽章 + 箭头 */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: `translate(-50%, -50%) scale(${Math.max(vsPop, 0.001)}) rotate(${(1 - vsPop) * -30}deg)`,
          zIndex: 2,
        }}
      >
        <div
          style={{
            width: orientation === "short" ? 72 : 88,
            height: orientation === "short" ? 72 : 88,
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${theme.accent}, ${theme.accent}bb)`,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: orientation === "short" ? 26 : 32,
            fontWeight: 800,
            fontFamily: theme.titleFont,
            boxShadow: `0 8px 28px ${theme.accent}55`,
            letterSpacing: 1,
          }}
        >
          VS
        </div>
      </div>

      {/* after 卡 */}
      <div style={cardStyle(enterRight, "after")}>
        <div
          style={{
            fontSize: titleSize,
            fontWeight: 700,
            color: theme.accent,
            fontFamily: theme.titleFont,
          }}
        >
          {after.title}
        </div>
        <div style={{ fontSize: descSize, color: theme.text, lineHeight: 1.5 }}>
          {after.desc}
        </div>
        {/* 右下角箭头装饰（after 更优暗示） */}
        <svg
          style={{ alignSelf: "flex-end", opacity: arrowOpacity }}
          width="40"
          height="40"
          viewBox="0 0 40 40"
        >
          <path
            d="M6,30 C14,30 22,20 34,10"
            fill="none"
            stroke={theme.accent}
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path
            d="M26,6 L36,9 L30,18"
            fill="none"
            stroke={theme.accent}
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
};
