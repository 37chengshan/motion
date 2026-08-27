import React from "react";
import { AbsoluteFill } from "remotion";
import { useStyle } from "./StyleProvider";

/**
 * #6 报纸头条 — 外双线边框 + 报头装饰 + 分栏竖线 + 角落花纹
 */
export const NewspaperBackground: React.FC = () => {
  const { theme } = useStyle();

  return (
    <AbsoluteFill>
      {/* 纸张做旧晕染 */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse 90% 60% at 50% 50%, rgba(255,255,255,0.4), transparent 80%)",
        }}
      />
      {/* 外双线边框（报纸经典） */}
      <div
        style={{
          position: "absolute",
          inset: 34,
          border: `2.5px solid ${theme.text}`,
          opacity: 0.5,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 44,
          border: `1px solid ${theme.text}`,
          opacity: 0.35,
        }}
      />
      {/* 报头双横线 */}
      <div
        style={{
          position: "absolute",
          top: 150,
          left: "10%",
          right: "10%",
          height: 3,
          background: theme.text,
          opacity: 0.45,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 160,
          left: "10%",
          right: "10%",
          height: 1,
          background: theme.text,
          opacity: 0.35,
        }}
      />
      {/* 分栏竖线（细） */}
      {[1, 2].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: "22%",
            bottom: "14%",
            left: `${33.3 * i}%`,
            width: 1,
            background: theme.muted,
            opacity: 0.25,
          }}
        />
      ))}
      {/* 装饰性文字行（模拟铅字块） */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: `${34 + i * 9}%`,
            left: "12%",
            width: i % 2 === 0 ? "55%" : "40%",
            height: 2.5,
            background: theme.muted,
            opacity: 0.14,
            borderRadius: 2,
          }}
        />
      ))}
      {/* 四角花纹（复古装饰） */}
      {[
        { top: 52, left: 52 },
        { top: 52, right: 52 },
        { bottom: 52, left: 52 },
        { bottom: 52, right: 52 },
      ].map((pos, i) => (
        <svg
          key={i}
          style={{ position: "absolute", ...pos, opacity: 0.4 }}
          width="36"
          height="36"
          viewBox="0 0 36 36"
        >
          <path
            d={i < 2 ? "M0,16 Q16,16 16,0 M0,8 Q8,8 8,0" : "M0,20 Q16,20 16,36 M0,28 Q8,28 8,36"}
            fill="none"
            stroke={theme.accent}
            strokeWidth="1.5"
          />
        </svg>
      ))}
      {/* 底部日期条 */}
      <div
        style={{
          position: "absolute",
          bottom: 100,
          left: "50%",
          transform: "translateX(-50%)",
          fontFamily: theme.titleFont,
          fontSize: 15,
          letterSpacing: 6,
          color: theme.muted,
          opacity: 0.5,
        }}
      >
        ─── THE DAILY TECH ───
      </div>
    </AbsoluteFill>
  );
};
