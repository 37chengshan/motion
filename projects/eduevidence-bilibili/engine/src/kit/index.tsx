import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/* ================= 手帐风设计 token ================= */
export const C = {
  paper: "#FDFBF4",
  grid: "rgba(120,160,220,0.16)",
  ink: "#3B3A36",
  dim: "#8A857B",
  red: "#D2544A",
  orange: "#E8843C",
  yellow: "#F5B840",
  green: "#7BA05B",
  blue: "#5B8DB8",
  noteY: "#FFF7DE",
  noteG: "#E4F2D9",
  noteR: "#FDE3E3",
  noteB: "#E3EEF9",
};
export const KAI = '"Kaiti SC", "STKaiti", serif';
export const HEI = '"PingFang SC", sans-serif';
export const MONO = '"SF Mono", Menlo, monospace';

/**
 * 30fps 等效帧：所有动画时间按 30fps 帧数书写，60fps 渲染自动正确。
 * spring 一律传 fps: 30 + 30 基准帧。
 */
export const useF = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return frame * 30 / fps;
};

/** 帧区间插值（30 基准帧，clamp） */
export const anim = (f: number, start: number, dur: number, from = 0, to = 1) =>
  interpolate(f, [start, start + dur], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

/** spring 快捷（30 基准） */
export const usePop = (delay: number, damping = 12) => {
  const f = useF();
  return spring({ frame: f - delay, fps: 30, config: { damping } });
};

/* ================= 纸张背景 ================= */
export const Paper: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill
    style={{
      backgroundColor: C.paper,
      backgroundImage: `linear-gradient(${C.grid} 1px, transparent 1px), linear-gradient(90deg, ${C.grid} 1px, transparent 1px)`,
      backgroundSize: "44px 44px",
      color: C.ink,
      fontFamily: HEI,
    }}
  >
    {children}
  </AbsoluteFill>
);

/* ================= 胶带 ================= */
export const Tape: React.FC<{ style?: React.CSSProperties; color?: string; w?: number }> = ({
  style, color = "rgba(255,214,102,0.78)", w = 170,
}) => (
  <div style={{ position: "absolute", width: w, height: 40, background: color, opacity: 0.9, boxShadow: "0 2px 6px rgba(60,50,30,0.12)", ...style }} />
);

/* ================= 图钉 ================= */
export const Pin: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
  <div style={{ position: "absolute", width: 26, height: 26, borderRadius: "50%", background: "radial-gradient(circle at 35% 35%, #ff8a7a, #C0392B 70%)", boxShadow: "0 4px 8px rgba(0,0,0,0.25)", ...style }} />
);

/* ================= 便利贴 ================= */
export const StickyNote: React.FC<{
  delay: number;
  rotate?: number;
  color?: string;
  tape?: boolean;
  tearAt?: number;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({ delay, rotate = -1.5, color = C.noteY, tape = false, tearAt, style, children }) => {
  const f = useF();
  const pop = spring({ frame: f - delay, fps: 30, config: { damping: 11, mass: 0.9 } });
  const tear = tearAt !== undefined ? anim(f, tearAt, 22) : 0;
  if (f < delay - 1 && (tearAt === undefined || f < tearAt - 1)) return null;
  return (
    <div
      style={{
        position: "absolute",
        padding: "26px 34px",
        background: color,
        boxShadow: "0 14px 30px rgba(60,50,30,0.18)",
        transform: `rotate(${rotate + (1 - pop) * 7 - tear * 14}deg) scale(${0.65 + pop * 0.35}) translate(${tear * 260}px, ${tear * 120}px)`,
        opacity: tearAt !== undefined ? 1 - tear * 0.9 : pop,
        ...style,
      }}
    >
      {children}
      {tape ? (
        <Tape style={{ left: "50%", marginLeft: -85, top: -20, transform: "rotate(-3deg)" }} />
      ) : (
        <Pin style={{ top: -10, left: "50%", marginLeft: -13, opacity: pop }} />
      )}
    </div>
  );
};

/* ================= 印章 ================= */
export const Stamp: React.FC<{
  at: number; text: string; color?: string; size?: number; style?: React.CSSProperties; sub?: string;
}> = ({ at, text, color = C.red, size = 54, style, sub }) => {
  const f = useF();
  if (f < at) return null;
  const slam = anim(f, at, 7, 1.9, 1);
  const shake = f < at + 10 ? Math.sin((f - at) * 2.2) * 5 * (1 - (f - at) / 10) : 0;
  return (
    <div
      style={{
        display: "inline-block",
        transform: `scale(${slam}) rotate(-4deg) translate(${shake}px,0)`,
        border: `6px solid ${color}`,
        borderRadius: 18,
        color,
        padding: `${size * 0.28}px ${size * 0.7}px`,
        fontSize: size,
        fontWeight: 900,
        fontFamily: KAI,
        letterSpacing: 6,
        background: "rgba(255,255,255,0.72)",
        opacity: 0.94,
        textAlign: "center",
        lineHeight: 1.15,
        ...style,
      }}
    >
      {text}
      {sub ? <div style={{ fontSize: size * 0.42, fontWeight: 700, letterSpacing: 2, marginTop: 6, color: C.dim }}>{sub}</div> : null}
    </div>
  );
};

/* ================= 手绘圈（逐笔） ================= */
export const HandCircle: React.FC<{
  at: number; dur?: number; w: number; h: number; color?: string; style?: React.CSSProperties;
}> = ({ at, dur = 26, w, h, color = C.red, style }) => {
  const f = useF();
  const p = anim(f, at, dur);
  if (f < at) return null;
  const len = 2 * (w + h) * 0.92;
  return (
    <svg width={w + 60} height={h + 60} viewBox={`0 0 ${w + 60} ${h + 60}`} style={{ position: "absolute", pointerEvents: "none", ...style }}>
      <ellipse cx={(w + 60) / 2} cy={(h + 60) / 2} rx={w / 2 + 8} ry={h / 2 + 14} fill="none" stroke={color}
        strokeWidth={9} strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - p)}
        transform={`rotate(-5 ${(w + 60) / 2} ${(h + 60) / 2})`} opacity={0.92} />
    </svg>
  );
};

/* ================= 手绘下划线 ================= */
export const HandUnderline: React.FC<{
  at: number; dur?: number; w: number; color?: string; thickness?: number; style?: React.CSSProperties;
}> = ({ at, dur = 18, w, color = C.red, thickness = 9, style }) => {
  const f = useF();
  const p = anim(f, at, dur);
  if (f < at) return null;
  return (
    <svg width={w + 30} height={26} viewBox={`0 0 ${w + 30} 26`} style={{ position: "absolute", ...style }}>
      <path d={`M 6 16 C ${w * 0.3} 10, ${w * 0.7} 22, ${w + 22} 12`} fill="none" stroke={color} strokeWidth={thickness}
        strokeLinecap="round" strokeDasharray={w + 40} strokeDashoffset={(w + 40) * (1 - p)} />
    </svg>
  );
};

/* ================= 手绘勾 ================= */
export const HandCheck: React.FC<{ at: number; size?: number; color?: string; style?: React.CSSProperties }> = ({
  at, size = 90, color = C.green, style,
}) => {
  const f = useF();
  const p1 = anim(f, at, 10);
  const p2 = anim(f, at + 9, 10);
  if (f < at) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ position: "absolute", ...style }}>
      <path d="M 18 55 L 42 78" stroke={color} strokeWidth={12} strokeLinecap="round" fill="none" strokeDasharray={40} strokeDashoffset={40 * (1 - p1)} />
      <path d="M 42 78 L 84 22" stroke={color} strokeWidth={12} strokeLinecap="round" fill="none" strokeDasharray={72} strokeDashoffset={72 * (1 - p2)} />
    </svg>
  );
};

/* ================= 打字机 ================= */
export const Typewriter: React.FC<{
  at: number; text: string; cps?: number; fontSize?: number; color?: string;
  cursor?: boolean; cursorUntil?: number; style?: React.CSSProperties; weight?: number; family?: string;
}> = ({ at, text, cps = 11, fontSize = 34, color = C.ink, cursor = true, cursorUntil, style, weight = 400, family = MONO }) => {
  const f = useF();
  const chars = Math.min(text.length, Math.max(0, Math.floor(((f - at) / 30) * cps)));
  if (f < at) return null;
  const showCursor = cursor && (cursorUntil === undefined || f < cursorUntil) && Math.floor(f / 8) % 2 === 0;
  return (
    <div style={{ fontSize, fontFamily: family, color, whiteSpace: "pre-wrap", lineHeight: 1.55, fontWeight: weight, ...style }}>
      {text.slice(0, chars)}
      {showCursor ? <span style={{ background: C.ink, color: C.paper, padding: "0 6px" }}>▊</span> : null}
    </div>
  );
};

/* ================= 荧光笔 ================= */
export const Highlight: React.FC<{
  at: number; w: number; h?: number; color?: string; dur?: number; style?: React.CSSProperties;
}> = ({ at, w, h = 52, color = "rgba(245,184,64,0.85)", dur = 16, style }) => {
  const f = useF();
  const p = anim(f, at, dur);
  if (f < at) return null;
  return (
    <div style={{ position: "absolute", width: w, height: h, background: color, borderRadius: 8, transform: `scaleX(${p}) rotate(-0.6deg)`, transformOrigin: "left center", ...style }} />
  );
};

/* ================= 木尺 → 刻度轴 ================= */
export const RulerAxis: React.FC<{
  slideAt: number; morphAt: number; w: number;
  ticks: { label: string; at: number }[];
  children?: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ slideAt, morphAt, w, ticks, children, style }) => {
  const f = useF();
  const slide = spring({ frame: f - slideAt, fps: 30, config: { damping: 14 } });
  const morph = anim(f, morphAt, 14);
  if (f < slideAt) return null;
  return (
    <div style={{ position: "relative", width: w, height: 120, ...style }}>
      <div
        style={{
          position: "absolute", left: 0, top: 30, width: w, height: 64,
          background: "linear-gradient(180deg,#E8C88F,#D9B26F)", borderRadius: 8,
          transform: `translateX(${(1 - slide) * -600}px) rotate(${(1 - slide) * -4}deg)`,
          opacity: 1 - morph, boxShadow: "0 8px 20px rgba(60,50,30,0.2)",
        }}
      >
        {Array.from({ length: 24 }).map((_, i) => (
          <div key={i} style={{ position: "absolute", left: 20 + (i * (w - 40)) / 23, top: 8, width: 3, height: i % 4 === 0 ? 30 : 18, background: "rgba(90,60,20,0.65)" }} />
        ))}
        <div style={{ position: "absolute", left: 16, bottom: 6, fontSize: 20, color: "rgba(90,60,20,0.8)", fontFamily: MONO }}>cm</div>
      </div>
      <div style={{ position: "absolute", inset: 0, opacity: morph }}>
        <div style={{ position: "absolute", left: 0, top: 58, width: w, height: 5, background: C.ink, borderRadius: 3, transform: `scaleX(${morph})`, transformOrigin: "left center" }} />
        {ticks.map((t, i) => (
          <div key={i} style={{ position: "absolute", left: t.at * (w - 40) + 20, top: 40, transform: "translateX(-50%)", textAlign: "center" }}>
            <div style={{ width: 4, height: 22, background: C.ink, margin: "0 auto" }} />
            <div style={{ fontSize: 24, fontFamily: KAI, fontWeight: 700, color: C.ink, marginTop: 4, whiteSpace: "nowrap" }}>{t.label}</div>
          </div>
        ))}
        {children}
      </div>
    </div>
  );
};

/* ================= 翻页擦除 ================= */
export const PageFlip: React.FC<{ at: number }> = ({ at }) => {
  const f = useF();
  if (f < at || f > at + 26) return null;
  const p = (f - at) / 26;
  const x = p < 0.5 ? interpolate(p, [0, 0.5], [-1920, 0]) : interpolate(p, [0.5, 1], [0, 1920]);
  return (
    <AbsoluteFill style={{ pointerEvents: "none", zIndex: 50 }}>
      <div style={{ position: "absolute", top: -40, left: x - 60, width: 2040, height: 1160, background: C.paper, boxShadow: "24px 0 60px rgba(60,50,30,0.25)", transform: "rotate(1.2deg)" }} />
      <div style={{ position: "absolute", top: -40, left: x + 1970, width: 26, height: 1160, background: "rgba(60,50,30,0.18)" }} />
    </AbsoluteFill>
  );
};

/* ================= 横线逐行画出 ================= */
export const NoteLine: React.FC<{
  at: number; w: number; delayStep?: number; rows: number; color?: string; style?: React.CSSProperties;
}> = ({ at, w, delayStep = 9, rows, color = "rgba(91,141,184,0.4)", style }) => {
  const f = useF();
  return (
    <div style={{ position: "relative", ...style }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ width: w, height: 3, background: color, transform: `scaleX(${anim(f, at + i * delayStep, 12)})`, transformOrigin: "left center", marginBottom: 46 }} />
      ))}
    </div>
  );
};

/* ================= 进度猫（duration30 = 总时长×30） ================= */
export const ProgressCat: React.FC<{ duration30: number; sitFrom?: number }> = ({ duration30, sitFrom }) => {
  const f = useF();
  const walking = sitFrom === undefined || f < sitFrom;
  const p = Math.min(1, (walking ? f : sitFrom ?? duration30) / duration30);
  const bob = walking ? Math.sin(f / 2.6) * 5 : 0;
  const tail = Math.sin(f / 3.4) * 16;
  const ear = f % 26 < 3 && walking ? 1.25 : 1;
  const x = 60 + p * 1720;
  return (
    <div style={{ position: "absolute", left: 0, bottom: 0, width: "100%", height: 26, background: "#EFE9DA", borderTop: "3px dashed #C9BFA5", zIndex: 60 }}>
      <div style={{ position: "absolute", left: 0, top: -3, height: 5, width: `${p * 100}%`, background: "repeating-linear-gradient(90deg,#F5B840,#F5B840 22px,#E8A62E 22px,#E8A62E 44px)" }} />
      <svg width={92} height={72} viewBox="0 0 92 72" style={{ position: "absolute", left: x - 46, top: -68, transform: `translateY(${bob}px)` }}>
        <g>
          <path d="M 70 44 Q 88 40 84 22" stroke="#E8843C" strokeWidth={7} fill="none" strokeLinecap="round" style={{ transform: `rotate(${tail}deg)`, transformOrigin: "70px 44px" }} />
          <ellipse cx="52" cy="46" rx="24" ry="16" fill="#F5A25D" />
          <circle cx="24" cy="34" r="16" fill="#F5A25D" />
          <path d="M 12 24 L 9 10 L 21 18 Z" fill="#F5A25D" transform={`scale(${ear}) translate(${(1 - ear) * 14},0)`} />
          <path d="M 30 22 L 34 9 L 38 23 Z" fill="#F5A25D" transform={`scale(${ear}) translate(${(1 - ear) * -6},0)`} />
          <circle cx="19" cy="32" r="2.4" fill="#3B3A36" />
          <circle cx="29" cy="32" r="2.4" fill="#3B3A36" />
          <path d="M 21 39 Q 24 41 27 39" stroke="#3B3A36" strokeWidth={2} fill="none" strokeLinecap="round" />
          <path d="M 52 34 q 4 3 8 0 M 56 42 q 4 3 8 0" stroke="#E07B2E" strokeWidth={3} fill="none" strokeLinecap="round" />
          {walking ? (
            <g>
              <rect x="36" y="58" width="7" height="13" rx="3" fill="#E8843C" style={{ transform: `rotate(${Math.sin(f / 2.6) * 16}deg)`, transformOrigin: "39px 58px" }} />
              <rect x="60" y="58" width="7" height="13" rx="3" fill="#E8843C" style={{ transform: `rotate(${-Math.sin(f / 2.6) * 16}deg)`, transformOrigin: "63px 58px" }} />
            </g>
          ) : (
            <g>
              <rect x="36" y="58" width="7" height="13" rx="3" fill="#E8843C" />
              <rect x="60" y="58" width="7" height="13" rx="3" fill="#E8843C" />
            </g>
          )}
        </g>
      </svg>
    </div>
  );
};

/* ================= kicker（胶带标签） ================= */
export const Kicker: React.FC<{ at: number; text: string; color?: string }> = ({ at, text, color = "rgba(255,214,102,0.8)" }) => {
  const f = useF();
  const pop = spring({ frame: f - at, fps: 30, config: { damping: 13 } });
  if (f < at) return null;
  return (
    <div style={{ position: "relative", marginBottom: 34, transform: `rotate(-1.4deg) scale(${pop})`, transformOrigin: "left center", opacity: pop }}>
      <div style={{ display: "inline-block", background: color, padding: "12px 34px", fontSize: 32, fontWeight: 700, fontFamily: KAI, letterSpacing: 6, boxShadow: "0 4px 10px rgba(60,50,30,0.12)" }}>
        {text}
      </div>
    </div>
  );
};
