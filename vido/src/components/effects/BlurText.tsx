import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { useStyle } from "../../compositions/styles/StyleProvider";

interface Props {
  text: string;
  fontSize?: number;
  color?: string;
  fontFamily?: string;
}

/**
 * #8 BlurText — 模糊→清晰的逐词揭示
 */
export const BlurText: React.FC<Props> = ({
  text,
  fontSize = 48,
  color,
  fontFamily,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { theme } = useStyle();

  const words = text.split(" ");

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: "0.4em",
        fontFamily: fontFamily ?? theme.fontFamily,
        fontSize,
        color: color ?? theme.text,
        lineHeight: 1.5,
        textAlign: "center",
      }}
    >
      {words.map((word, i) => {
        const start = i * 6;
        const blur = interpolate(frame - start, [0, 12], [12, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const opacity = interpolate(frame - start, [0, 10], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        // 淡入位移：从下方 14px 上浮到位，避免纯 blur 显呆板
        const translateY = interpolate(frame - start, [0, 14], [14, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              filter: `blur(${blur}px)`,
              opacity,
              transform: `translateY(${translateY}px)`,
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};
