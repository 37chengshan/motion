import React from "react";
import { useCurrentFrame } from "remotion";
import { TypewriterEffect } from "./TypewriterEffect";

interface Props {
  content: string;
  title?: string;
}

/**
 * #29 TerminalTypewriter — macOS 终端窗口 + 命令逐行打字
 */
export const TerminalTypewriter: React.FC<Props> = ({
  content,
  title = "vido — zsh",
}) => {
  const lines = content.split("\n");
  // 每行独立打字速度：命令行 3 帧/字符，输出行 1.2 帧/字符
  const perChar = (line: string) => (line.startsWith("$") ? 3 : 1.2);

  const frame = useCurrentFrame();
  const visibleLines: string[] = [];
  let remaining = frame;

  for (const line of lines) {
    const len = line.length;
    const cost = len * perChar(line);
    if (remaining <= 0) {
      break;
    }
    if (remaining >= cost) {
      visibleLines.push(line);
      remaining -= cost;
    } else {
      const chars = Math.floor(remaining / perChar(line));
      visibleLines.push(line.slice(0, chars));
      remaining = 0;
    }
  }

  return (
    <div
      style={{
        width: "100%",
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
        background: "#1e1e1e",
        fontFamily: "'SF Mono', 'Fira Code', Consolas, monospace",
      }}
    >
      {/* 标题栏 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "14px 16px",
          background: "#2d2d2d",
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840" }} />
        </div>
        <div
          style={{
            flex: 1,
            textAlign: "center",
            color: "#aaa",
            fontSize: 13,
          }}
        >
          {title}
        </div>
        <div style={{ width: 60 }} />
      </div>
      {/* 内容 */}
      <div style={{ padding: "20px 24px", minHeight: 200 }}>
        {visibleLines.map((line, i) => (
          <div
            key={i}
            style={{
              color: line.startsWith("$") ? "#7dd3fc" : "#a5d6a7",
              fontSize: 16,
              lineHeight: 1.7,
              whiteSpace: "pre-wrap",
            }}
          >
            {line.startsWith("$") ? (
              <>
                <span style={{ color: "#c084fc" }}>❯ </span>
                {line.slice(1)}
              </>
            ) : (
              line
            )}
          </div>
        ))}
        {/* 光标（帧驱动闪烁，保证渲染确定性；每 16 帧切换） */}
        <span
          style={{
            display: "inline-block",
            width: 9,
            height: 18,
            marginTop: 6,
            background: "#98c379",
            opacity: Math.floor(frame / 16) % 2 === 0 ? 1 : 0,
          }}
        />
      </div>
    </div>
  );
};
