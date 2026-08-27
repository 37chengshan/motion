import React from "react";
import { useCurrentFrame, spring, useVideoConfig } from "remotion";
import { useStyle } from "../../compositions/styles/StyleProvider";

interface Props {
  items: string[];
}

/**
 * 列表 — 序号徽章 + 逐项弹簧进入 + 高亮条
 */
export const ListBlock: React.FC<Props> = ({ items }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { theme, orientation } = useStyle();
  const fontSize = orientation === "short" ? 44 : 56;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: fontSize * 0.62,
        fontFamily: theme.fontFamily,
      }}
    >
      {items.map((item, i) => {
        const delay = i * 12;
        const y = spring({
          frame: frame - delay,
          fps,
          config: { damping: 14, stiffness: 120 },
        });
        const opacity = spring({
          frame: frame - delay,
          fps,
          config: { damping: 200 },
        });
        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: fontSize * 0.5,
              transform: `translateX(${(1 - Math.max(y, 0.001)) * -48}px)`,
              opacity,
            }}
          >
            {/* 序号徽章 */}
            <div
              style={{
                width: fontSize * 0.82,
                height: fontSize * 0.82,
                borderRadius: "50%",
                background: `linear-gradient(135deg, ${theme.accent}, ${theme.accent}cc)`,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: fontSize * 0.42,
                fontWeight: 700,
                flexShrink: 0,
                boxShadow: `0 4px 14px ${theme.accent}44`,
                fontFamily: theme.titleFont,
              }}
            >
              {i + 1}
            </div>
            {/* 内容 + 底部高亮条 */}
            <div style={{ position: "relative", display: "inline-block" }}>
              <span style={{ fontSize, color: theme.text, lineHeight: 1.4, display: "block" }}>
                {item}
              </span>
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  bottom: -6,
                  height: 3,
                  width: `${Math.min(100, Math.max(0, (frame - delay - 8) * 3))}%`,
                  background: `linear-gradient(90deg, ${theme.accent}, transparent)`,
                  borderRadius: 2,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};
