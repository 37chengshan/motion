import React from "react";
import { useCurrentFrame, spring, useVideoConfig } from "remotion";
import { useStyle } from "../../compositions/styles/StyleProvider";

interface Props {
  text: string;
  fontSize?: number;
  color?: string;
  accent?: string;
  fontFamily?: string;
  subtitle?: string;
}

/** 中英混排分词：连续 CJK 字符逐字拆分，连续拉丁字符/数字作为一个词 */
const tokenize = (text: string): string[] => {
  const tokens: string[] = [];
  let buffer = "";
  let bufferIsLatin = false;
  for (const char of text) {
    const isLatin = /[A-Za-z0-9]/.test(char);
    if (buffer && isLatin === bufferIsLatin && isLatin) {
      buffer += char;
    } else {
      if (buffer) tokens.push(buffer);
      buffer = char;
      bufferIsLatin = isLatin;
    }
  }
  if (buffer) tokens.push(buffer);
  return tokens;
};

/**
 * #2 StaggerText — 弹簧逐字/逐词交错出现（中文逐字、英文逐词，带 overshoot 回弹）
 */
export const StaggerText: React.FC<Props> = ({
  text,
  fontSize = 64,
  color,
  accent,
  fontFamily,
  subtitle,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { theme } = useStyle();

  const tokens = tokenize(text);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 24,
        fontFamily: fontFamily ?? theme.titleFont,
        color: color ?? theme.text,
        textAlign: "center",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", maxWidth: "100%" }}>
        {tokens.map((token, i) => {
          const delay = i * 2.2;
          // overshoot：stiffness 高 damping 低，进入时略过冲再回弹
          const scale = spring({
            frame: frame - delay,
            fps,
            config: { damping: 11, stiffness: 190, mass: 0.9 },
          });
          const opacity = spring({
            frame: frame - delay - 3,
            fps,
            config: { damping: 200 },
          });
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                fontSize,
                transform: `scale(${Math.max(scale, 0.001)}) translateY(${(1 - scale) * -24}px)`,
                opacity,
                marginRight: /[A-Za-z0-9]/.test(token) ? fontSize * 0.28 : 0,
                whiteSpace: "pre",
              }}
            >
              {token === " " ? "\u00A0" : token}
            </span>
          );
        })}
      </div>
      {subtitle ? (
        <div
          style={{
            fontSize: fontSize * 0.32,
            color: accent ?? theme.muted,
            opacity: Math.min(frame / 20, 1),
            letterSpacing: 2,
            fontFamily: fontFamily ?? theme.fontFamily,
          }}
        >
          {subtitle}
        </div>
      ) : null}
    </div>
  );
};
