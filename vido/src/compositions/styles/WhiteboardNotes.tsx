import React from "react";
import { AbsoluteFill } from "remotion";
import { useStyle } from "./StyleProvider";

/**
 * #3 白板笔记 — 精细点阵 + 手绘虚线框 + 下划波浪 + 精修便签
 */
export const WhiteboardBackground: React.FC = () => {
  const { theme } = useStyle();

  // 点阵（CSS radial-gradient 重复，比 960 个 div 高效且更细密）
  const dotSize = 1.6;
  const gap = 34;

  return (
    <AbsoluteFill>
      {/* 点阵背景 */}
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(circle, rgba(0,0,0,0.07) ${dotSize}px, transparent ${dotSize}px)`,
          backgroundSize: `${gap}px ${gap}px`,
        }}
      />
      {/* 左上角淡色块（白板光斑） */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse 50% 28% at 20% 0%, rgba(255,255,255,0.9), transparent 70%)",
        }}
      />
      {/* 手绘虚线框（右上，马克笔风） */}
      <svg
        style={{ position: "absolute", top: 90, right: 70, opacity: 0.35 }}
        width="200"
        height="150"
        viewBox="0 0 200 150"
      >
        <path
          d="M8,12 C60,6 150,8 192,14 C196,50 194,100 190,138 C140,144 60,142 12,136 C6,100 6,50 8,12 Z"
          fill="none"
          stroke={theme.accent}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="10 7"
        />
      </svg>
      {/* 右下角手绘箭头 */}
      <svg
        style={{ position: "absolute", bottom: 200, right: 60, opacity: 0.45 }}
        width="160"
        height="110"
        viewBox="0 0 160 110"
      >
        <path
          d="M10,95 C55,95 85,40 145,22"
          fill="none"
          stroke={theme.accent}
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path
          d="M122,10 L148,20 L126,36"
          fill="none"
          stroke={theme.accent}
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {/* 左下波浪下划线（马克笔重点强调） */}
      <svg
        style={{ position: "absolute", bottom: 300, left: 50, opacity: 0.3 }}
        width="180"
        height="24"
        viewBox="0 0 180 24"
      >
        <path
          d="M4,12 Q14,4 24,12 T44,12 T64,12 T84,12 T104,12 T124,12 T144,12 T164,12 T176,12"
          fill="none"
          stroke={theme.accent}
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      {/* 右上便签纸（精修：胶带+双层阴影） */}
      <div
        style={{
          position: "absolute",
          top: 100,
          right: 110,
          width: 130,
          height: 150,
          background: "linear-gradient(160deg, #fff9db, #fff3b8)",
          transform: "rotate(7deg)",
          boxShadow: "1px 2px 4px rgba(0,0,0,0.08), 6px 10px 18px rgba(0,0,0,0.12)",
          borderTop: `16px solid ${theme.accent}`,
          opacity: 0.9,
        }}
      >
        {/* 便签上的假手写行 */}
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              margin: `${12 + i * 22}px 12px 0`,
              height: 3,
              background: "rgba(0,0,0,0.12)",
              borderRadius: 2,
              width: `${86 - i * 14}%`,
            }}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};
