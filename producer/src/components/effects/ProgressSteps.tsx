import React from "react";
import { useCurrentFrame, useVideoConfig, spring } from "remotion";
import { useStyle } from "../../compositions/styles/StyleProvider";

interface Props {
  steps: string[];
  /** 高亮到第几步（0 起）；默认随帧自动推进 */
  activeIndex?: number;
  /** 每步自动推进的间隔帧数（activeIndex 未指定时生效） */
  stepInterval?: number;
}

/**
 * ProgressSteps — 步骤进度指示器（圆点+连接线依次填充，当前步弹跳放大）
 * 参考 RVE progress-steps 模式
 */
export const ProgressSteps: React.FC<Props> = ({
  steps,
  activeIndex,
  stepInterval = 30,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { theme, orientation } = useStyle();
  const dotSize = orientation === "short" ? 34 : 42;
  const lineLen = orientation === "short" ? 70 : 96;

  const autoActive = Math.min(steps.length - 1, Math.floor((frame - 20) / stepInterval));
  const active = activeIndex ?? Math.max(0, autoActive);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        fontFamily: theme.fontFamily,
      }}
    >
      {steps.map((step, i) => {
        const isDone = i < active;
        const isActive = i === active;
        // 每步入场延迟
        const enter = spring({
          frame: frame - i * 8,
          fps,
          config: { damping: 14, stiffness: 130 },
        });
        // 当前步的呼吸放大
        const pulse = isActive
          ? 1 + Math.sin((frame / fps) * Math.PI * 2) * 0.08
          : 1;

        return (
          <React.Fragment key={i}>
            {/* 步骤圆点 */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                transform: `translateY(${(1 - Math.max(enter, 0.001)) * 30}px)`,
                opacity: enter,
              }}
            >
              <div
                style={{
                  width: dotSize,
                  height: dotSize,
                  borderRadius: "50%",
                  background: isDone
                    ? theme.accent
                    : isActive
                      ? `linear-gradient(135deg, ${theme.accent}, ${theme.accent}cc)`
                      : "#e4e4e7",
                  color: isDone || isActive ? "#fff" : theme.muted,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: dotSize * 0.42,
                  fontWeight: 700,
                  fontFamily: theme.titleFont,
                  transform: `scale(${pulse})`,
                  boxShadow: isActive ? `0 6px 20px ${theme.accent}55` : "none",
                  transition: "none",
                }}
              >
                {isDone ? "✓" : i + 1}
              </div>
              <div
                style={{
                  fontSize: orientation === "short" ? 22 : 26,
                  color: isActive ? theme.text : theme.muted,
                  fontWeight: isActive ? 700 : 400,
                  textAlign: "center",
                  maxWidth: dotSize * 2.4,
                  lineHeight: 1.3,
                }}
              >
                {step}
              </div>
            </div>
            {/* 连接线 */}
            {i < steps.length - 1 && (
              <div
                style={{
                  width: lineLen,
                  height: 4,
                  borderRadius: 2,
                  marginTop: dotSize / 2 - 2,
                  marginLeft: 8,
                  marginRight: 8,
                  background: "#e4e4e7",
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${Math.min(100, Math.max(0, (frame - 20 - i * stepInterval) / (stepInterval / 1.2) * 100))}%`,
                    background: `linear-gradient(90deg, ${theme.accent}88, ${theme.accent})`,
                    borderRadius: 2,
                  }}
                />
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};
