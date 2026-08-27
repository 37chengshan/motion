import React from "react";
import { AbsoluteFill } from "remotion";

const NOTES = [
  { top: "7%", left: "5%", rotate: -6, color: "#feca57", text: "IDEA", w: 108, h: 108 },
  { top: "15%", right: "7%", rotate: 4, color: "#ff9ff3", text: "TODO", w: 96, h: 96 },
  { top: "48%", left: "3%", rotate: 7, color: "#54a0ff", text: "NOTE", w: 90, h: 90 },
  { top: "60%", right: "4%", rotate: -4, color: "#5f27cd", text: "NEW", w: 100, h: 100 },
  { bottom: "22%", left: "10%", rotate: 3, color: "#1dd1a1", text: "OK", w: 84, h: 84 },
];

/**
 * #5 便利贴墙 — 精修便签（折角+双层阴影+半透明胶带）+ 墙面横线
 */
export const StickyNotesBackground: React.FC = () => {
  return (
    <AbsoluteFill>
      {/* 墙面淡横线 */}
      <AbsoluteFill
        style={{
          backgroundImage: "linear-gradient(rgba(0,0,0,0.02) 1px, transparent 1px)",
          backgroundSize: "100% 56px",
        }}
      />
      {/* 顶部暖光 */}
      <AbsoluteFill
        style={{
          background: "radial-gradient(ellipse 60% 25% at 50% -5%, rgba(255,222,125,0.18), transparent 70%)",
        }}
      />
      {NOTES.map((n, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: n.top,
            left: n.left,
            right: n.right,
            bottom: n.bottom,
            width: n.w,
            height: n.h,
            background: `linear-gradient(160deg, ${n.color}, ${n.color}dd)`,
            transform: `rotate(${n.rotate}deg)`,
            boxShadow: "1px 2px 3px rgba(0,0,0,0.10), 5px 8px 16px rgba(0,0,0,0.14)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "monospace",
            fontWeight: 700,
            color: "#2d3436",
            fontSize: 15,
            letterSpacing: 2,
            opacity: 0.75,
            borderRadius: 2,
          }}
        >
          {/* 半透明胶带（两端微透明差异 + 锯齿边模拟） */}
          <div
            style={{
              position: "absolute",
              top: -13,
              left: "28%",
              width: 52,
              height: 26,
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,255,255,0.35))",
              transform: "rotate(-2deg)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
            }}
          />
          {/* 右下折角 */}
          <svg
            style={{ position: "absolute", right: 0, bottom: 0 }}
            width="22"
            height="22"
            viewBox="0 0 22 22"
          >
            <path d="M0,22 L22,22 L22,0 Z" fill="rgba(0,0,0,0.10)" />
            <path d="M0,22 L22,0 L22,4 L4,22 Z" fill="rgba(255,255,255,0.35)" />
          </svg>
          {n.text}
        </div>
      ))}
    </AbsoluteFill>
  );
};
