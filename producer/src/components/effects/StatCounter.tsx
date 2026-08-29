import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { useStyle } from "../../compositions/styles/StyleProvider";

interface Props {
  /** 目标数值 */
  value: number;
  /** 数字标签（如 "GitHub Stars"） */
  label: string;
  /** 前缀符号（如 "$"） */
  prefix?: string;
  /** 后缀（如 "%" / "k"） */
  suffix?: string;
  /** 数字字号 */
  fontSize?: number;
  /** 千分位逗号 */
  comma?: boolean;
}

const formatNumber = (n: number, comma: boolean) => {
  const rounded = Math.round(n);
  return comma ? rounded.toLocaleString("en-US") : String(rounded);
};

/**
 * StatCounter — 数字滚动计数（spring 减速曲线），配标签与强调色
 * 参考 RVE stat-counter 模式
 */
export const StatCounter: React.FC<Props> = ({
  value,
  label,
  prefix = "",
  suffix = "",
  fontSize,
  comma = true,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { theme, orientation } = useStyle();
  const size = fontSize ?? (orientation === "short" ? 96 : 120);

  // spring 驱动的计数进度（带轻微 overshoot 后自然落定）
  const progress = spring({
    frame: frame - 5,
    fps,
    config: { damping: 26, stiffness: 90, mass: 1.1 },
  });
  const display = value * progress;

  // 标签淡入
  const labelOpacity = interpolate(frame, [20, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        fontFamily: theme.titleFont,
      }}
    >
      <div
        style={{
          fontSize: size,
          fontWeight: 800,
          color: theme.accent,
          letterSpacing: -2,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          textShadow: `0 2px 24px ${theme.accent}33`,
        }}
      >
        {prefix}
        {formatNumber(display, comma)}
        {suffix}
      </div>
      <div
        style={{
          fontSize: size * 0.2,
          color: theme.muted,
          letterSpacing: 4,
          opacity: labelOpacity,
          fontFamily: theme.fontFamily,
        }}
      >
        {label}
      </div>
      {/* 底部装饰线 */}
      <div
        style={{
          width: `${Math.min(100, Math.max(0, (frame - 15) * 2.5))}%`,
          height: 3,
          background: `linear-gradient(90deg, transparent, ${theme.accent}, transparent)`,
          borderRadius: 2,
          opacity: labelOpacity,
        }}
      />
    </div>
  );
};
