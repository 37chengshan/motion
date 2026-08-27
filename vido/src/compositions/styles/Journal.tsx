import React from "react";
import { AbsoluteFill } from "remotion";
import { useStyle } from "./StyleProvider";

/**
 * #9 手账日记 — 细腻信纸横线 + 双红线页边 + 和纸胶带标签 + 日期印章
 */
export const JournalBackground: React.FC = () => {
  const { theme } = useStyle();

  return (
    <AbsoluteFill>
      {/* 信纸横线（CSS 重复，56px 行距） */}
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(transparent 55px, ${theme.muted}22 55px, ${theme.muted}22 56px)`,
          backgroundSize: "100% 56px",
          backgroundPosition: "0 120px",
        }}
      />
      {/* 红色页边双线 */}
      <div
        style={{
          position: "absolute",
          left: 88,
          top: 60,
          bottom: 60,
          width: 2.5,
          background: "rgba(225,112,85,0.35)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 96,
          top: 60,
          bottom: 60,
          width: 1,
          background: "rgba(225,112,85,0.22)",
        }}
      />
      {/* 顶部装订孔（手账环） */}
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: 30,
            top: 180 + i * 420,
            width: 26,
            height: 26,
            borderRadius: "50%",
            border: `2px solid ${theme.muted}`,
            opacity: 0.3,
            background: theme.background,
          }}
        />
      ))}
      {/* 和纸胶带标签（左下，半透明条纹质感） */}
      <div
        style={{
          position: "absolute",
          bottom: 200,
          left: 40,
          width: 150,
          height: 44,
          background:
            "repeating-linear-gradient(45deg, rgba(255,214,165,0.75) 0 8px, rgba(255,224,178,0.55) 8px 16px)",
          transform: "rotate(-4deg)",
          boxShadow: "1px 2px 5px rgba(0,0,0,0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: theme.titleFont,
          fontSize: 15,
          color: "#a0714f",
          letterSpacing: 3,
        }}
      >
        memo ✎
      </div>
      {/* 右上小贴纸（保持温暖感） */}
      <div
        style={{
          position: "absolute",
          top: 130,
          right: 70,
          width: 86,
          height: 86,
          background: "linear-gradient(150deg, rgba(255,233,212,0.75), rgba(255,218,185,0.5))",
          transform: "rotate(8deg)",
          borderRadius: "50%",
          boxShadow: "1px 2px 5px rgba(0,0,0,0.06)",
          border: "1px dashed rgba(224,168,130,0.5)",
        }}
      />
      {/* 右下日期印章圈 */}
      <div
        style={{
          position: "absolute",
          bottom: 280,
          right: 60,
          width: 90,
          height: 90,
          borderRadius: "50%",
          border: `2px solid ${theme.accent}`,
          opacity: 0.3,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: theme.titleFont,
          fontSize: 14,
          color: theme.accent,
          transform: "rotate(12deg)",
        }}
      >
        daily
      </div>
    </AbsoluteFill>
  );
};
