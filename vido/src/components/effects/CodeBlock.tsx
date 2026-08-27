import React from "react";
import { useCurrentFrame } from "remotion";
import { TypewriterEffect } from "./TypewriterEffect";

interface Props {
  code: string;
  language?: string;
}

/**
 * 代码块 — 深色背景 + 语法着色 + 打字机效果
 */
export const CodeBlock: React.FC<Props> = ({ code, language = "bash" }) => {
  return (
    <div
      style={{
        width: "100%",
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
        background: "#282c34",
        fontFamily: "'SF Mono', 'Fira Code', Consolas, monospace",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 18px",
          background: "#21252b",
        }}
      >
        <span style={{ color: "#7f848e", fontSize: 13 }}>{language}</span>
        <span style={{ color: "#4b5263", fontSize: 12 }}>vido</span>
      </div>
      <div style={{ padding: "20px 24px" }}>
        <TypewriterEffect
          text={code}
          fontSize={17}
          color="#abb2bf"
          fontFamily="'SF Mono', 'Fira Code', Consolas, monospace"
          framesPerChar={1.5}
          caretColor="#98c379"
        />
      </div>
    </div>
  );
};
