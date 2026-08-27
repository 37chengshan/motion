import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import type { CharacterType } from "../../data/types";

interface Props {
  /** 进度 0~1 */
  progress: number;
  character?: CharacterType;
  label?: string;
}

const CHAR_EMOJI: Record<CharacterType, string> = {
  cat: "🐱",
  dog: "🐶",
  "anime-girl": "👧",
  "pixel-hero": "🦸",
  rocket: "🚀",
};

/**
 * 角色进度条 — 小动物/动漫人物代替传统进度条
 * 角色沿进度轨道"跑"到当前位置，身后留下渐变轨迹
 */
export const CharacterProgressBar: React.FC<Props> = ({
  progress,
  character = "cat",
  label,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 角色上下弹跳
  const bounce = Math.sin(frame / (fps / 6)) * 6;

  const pct = Math.min(1, Math.max(0, progress)) * 100;
  const emoji = CHAR_EMOJI[character] ?? "🐱";

  return (
    <div
      style={{
        position: "absolute",
        bottom: 50,
        left: 60,
        right: 60,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {label ? (
        <div
          style={{
            fontSize: 22,
            color: "rgba(0,0,0,0.5)",
            fontFamily: "sans-serif",
          }}
        >
          {label}
        </div>
      ) : null}
      <div style={{ position: "relative", height: 56 }}>
        {/* 轨道底色 */}
        <div
          style={{
            position: "absolute",
            top: 24,
            left: 0,
            right: 0,
            height: 8,
            borderRadius: 4,
            background: "rgba(0,0,0,0.08)",
          }}
        />
        {/* 已走过轨迹 */}
        <div
          style={{
            position: "absolute",
            top: 24,
            left: 0,
            width: `${pct}%`,
            height: 8,
            borderRadius: 4,
            background: "linear-gradient(90deg, #54a0ff, #007AFF)",
          }}
        />
        {/* 角色 */}
        <div
          style={{
            position: "absolute",
            top: bounce,
            left: `calc(${pct}% - 20px)`,
            fontSize: 44,
            transform: "translateY(0)",
            filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.15))",
          }}
        >
          {emoji}
        </div>
      </div>
    </div>
  );
};
