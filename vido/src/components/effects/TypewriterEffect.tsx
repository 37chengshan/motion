import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { useStyle } from "../../compositions/styles/StyleProvider";

interface Props {
  text: string;
  fontSize?: number;
  color?: string;
  fontFamily?: string;
  /** 每字符耗时帧数 */
  framesPerChar?: number;
  /** 光标颜色 */
  caretColor?: string;
}

/**
 * #1 TypewriterText — 逐字打字机 + 闪烁光标
 */
export const TypewriterEffect: React.FC<Props> = ({
  text,
  fontSize = 48,
  color,
  fontFamily,
  framesPerChar = 2.5,
  caretColor,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { theme } = useStyle();

  const chars = Math.floor(frame / framesPerChar);
  const visible = text.slice(0, chars);
  const done = chars >= text.length;

  // 光标闪烁：每秒两次
  const caretVisible = done || Math.floor(frame / (fps / 2)) % 2 === 0;

  return (
    <div
      style={{
        fontFamily: fontFamily ?? theme.fontFamily,
        fontSize,
        color: color ?? theme.text,
        lineHeight: 1.4,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        textAlign: "center",
      }}
    >
      {visible}
      <span
        style={{
          display: "inline-block",
          width: fontSize * 0.06,
          height: fontSize * 0.9,
          marginLeft: 4,
          verticalAlign: "text-bottom",
          background: caretColor ?? theme.accent,
          opacity: caretVisible ? 1 : 0,
        }}
      />
    </div>
  );
};
