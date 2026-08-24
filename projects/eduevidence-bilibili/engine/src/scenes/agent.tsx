import React from "react";
import { AbsoluteFill } from "remotion";
import {
  C, KAI, HEI, MONO, Kicker, StickyNote, Stamp, HandUnderline, Typewriter,
  Highlight, anim, useF,
} from "../kit";

/* ========== V2 Agent1 · 25.5s 八智能体便利贴 ========== */
const AGENTS = [
  { en: "education-planner", zh: "规划器 · 定研究框架", tier: "旗舰", note: C.noteY, at: 129 },
  { en: "evidence-retriever", zh: "检索器 · 找正反证据", tier: "基础", note: C.noteG, at: 189 },
  { en: "evidence-analyst", zh: "分析师 · 逐条抽取", tier: "基础", note: C.noteB, at: 243 },
  { en: "skeptic", zh: "怀疑者 · 专职拆台", tier: "旗舰", note: C.noteR, at: 297 },
  { en: "method-reviewer", zh: "审计员 · 查研究成色", tier: "旗舰", note: C.noteY, at: 357 },
  { en: "evidence-judge", zh: "法官 · 下四态判决", tier: "旗舰", note: C.noteG, at: 423 },
  { en: "intervention-designer", zh: "干预设计师 · 落地方案", tier: "基础", note: C.noteB, at: 495 },
  { en: "evaluation-designer", zh: "评估设计师 · 验证效果", tier: "基础", note: C.noteY, at: 561 },
];
export const Agent1: React.FC = () => {
  const f = useF();
  return (
    <AbsoluteFill style={{ padding: "110px 130px" }}>
      <Kicker at={15} text="进阶 · Agent MCP 模式" />
      <div style={{ marginTop: 6, opacity: anim(f, 30, 12) }}>
        <Typewriter at={33} text="$ python3 start_agent_mcp.py --open" cps={12} fontSize={36} color={C.green} weight={700} cursorUntil={130} />
        <span style={{ fontSize: 28, color: C.dim, fontFamily: HEI }}>　· 本地守护进程 :8765</span>
      </div>
      <div style={{ position: "relative", height: 620, marginTop: 50 }}>
        {AGENTS.map((a, i) => {
          const col = i % 4, row = Math.floor(i / 4);
          return (
            <StickyNote
              key={a.en}
              delay={a.at}
              rotate={[-2, 1.5, -1.2, 2][col]}
              color={a.note}
              style={{ left: col * 420, top: row * 300, width: 380 }}
            >
              <div style={{ fontSize: 26, fontWeight: 800, fontFamily: MONO, color: C.blue }}>{a.en}</div>
              <div style={{ fontSize: 29, fontWeight: 700, fontFamily: KAI, margin: "10px 0 14px" }}>{a.zh}</div>
              <span style={{ fontSize: 21, fontWeight: 800, borderRadius: 999, padding: "4px 16px", border: `2.5px solid ${a.tier === "旗舰" ? C.orange : "#B9B2A2"}`, color: a.tier === "旗舰" ? C.orange : "#8A857B" }}>
                {a.tier}
              </span>
            </StickyNote>
          );
        })}
      </div>
      <div style={{ textAlign: "center", marginTop: 30, fontSize: 30, fontWeight: 700, color: C.dim, opacity: anim(f, 660, 14), fontFamily: HEI }}>
        Fast models collect · Strong models reason · Independent models verify
      </div>
    </AbsoluteFill>
  );
};

/* ========== V2 Agent2 · 31.5s 三基座铅笔盒 + 交叉审核 ========== */
const LANES = [
  { base: "Claude 基座", models: [{ n: "Opus 5", d: "旗舰 · 规划/判决", fs: true }, { n: "Sonnet 5", d: "基础 · 检索/抽取", fs: false }], x: 40 },
  { base: "Codex 基座", models: [{ n: "GPT-5.5", d: "旗舰 · 审计/怀疑", fs: true }, { n: "omp 通用兜底", d: "", fs: false, dim: true }], x: 580 },
  { base: "DSH 基座", models: [{ n: "DeepSeek v4 Pro", d: "旗舰 · 独立复核", fs: true }, { n: "v4 Flash", d: "基础 · 流水线", fs: false }], x: 1120 },
];
export const Agent2: React.FC = () => {
  const f = useF();
  const knock = f >= 855 ? Math.sin((f - 855) / 2.2) * 10 : 0;
  const spark = f >= 855 && f % 18 < 3 ? 1 : 0;
  return (
    <AbsoluteFill style={{ padding: "110px 130px" }}>
      <Kicker at={15} text="模型交叉 · 独立基座互相验证" />
      <div style={{ position: "relative", height: 460, marginTop: 10 }}>
        {LANES.map((lane, i) => (
          <div key={lane.base} style={{ position: "absolute", left: lane.x, top: 20, width: 460, opacity: anim(f, 60 + i * 24, 14), transform: `translateY(${(1 - anim(f, 60 + i * 24, 14)) * 60}px)` }}>
            <div style={{ fontSize: 36, fontWeight: 900, fontFamily: KAI, marginBottom: 16 }}>{lane.base}</div>
            {lane.models.map((m, j) => (
              <div key={m.n} style={{ background: m.dim ? "#F1EDE2" : m.fs ? "#FFF3D6" : C.noteB, border: `3px solid ${m.dim ? "#C9BFA5" : m.fs ? C.orange : C.blue}`, borderRadius: 14, padding: "18px 28px", marginBottom: 18, opacity: anim(f, 165 + i * 30 + j * 30, 12), transform: `rotate(${j === 0 ? -0.8 : 0.8}deg)` }}>
                <div style={{ fontSize: 32, fontWeight: 900, fontFamily: MONO, color: m.dim ? C.dim : m.fs ? C.orange : C.blue }}>{m.n}</div>
                {m.d ? <div style={{ fontSize: 22, color: C.dim, fontFamily: HEI, marginTop: 4 }}>{m.d}</div> : null}
              </div>
            ))}
          </div>
        ))}
      </div>
      {/* 交叉审核：两支铅笔互敲 */}
      <div style={{ position: "relative", height: 220, marginTop: 20 }}>
        <div style={{ position: "absolute", left: "50%", top: 30, transform: "translateX(-50%)" }}>
          <Stamp at={855 * 0.999} text="交叉审核" sub="同一个结论 · 互相挑刺" size={52} color={C.blue} />
        </div>
        <svg width={1920} height={200} viewBox="0 0 1920 200" style={{ position: "absolute", left: -130, top: -10, pointerEvents: "none" }}>
          <g style={{ transform: `rotate(${-14 + knock}deg)`, transformOrigin: "700px 160px" }}>
            <rect x="700" y="120" width="220" height="16" rx={8} fill="#F5B840" transform="rotate(24 700 160)" />
            <path d="M 700 128 L 676 160 L 706 158 Z" fill="#3B3A36" />
          </g>
          <g style={{ transform: `rotate(${14 - knock}deg)`, transformOrigin: "1220px 160px" }}>
            <rect x="1000" y="120" width="220" height="16" rx={8} fill="#5B8DB8" transform="rotate(-24 1220 160)" />
            <path d="M 1220 128 L 1244 160 L 1214 158 Z" fill="#3B3A36" />
          </g>
          {spark ? (
            <g fill={C.orange}>
              <path d="M 958 60 l 8 18 l -18 -8 Z" />
              <path d="M 966 30 l 5 12 l -12 -5 Z" />
              <path d="M 930 44 l 12 5 l -5 8 Z" />
            </g>
          ) : null}
        </svg>
      </div>
      <div style={{ textAlign: "center", marginTop: 30, opacity: anim(f, 1035, 16) }}>
        <span style={{ fontSize: 34, fontWeight: 700, fontFamily: KAI, border: `3px solid ${C.green}`, borderRadius: 999, padding: "16px 48px", background: "rgba(123,160,91,0.08)" }}>
          独立基座互相验证 · 谁也别想蒙混过关 → <b style={{ color: C.red }}>四态判决 · 每一步留痕</b>
        </span>
      </div>
    </AbsoluteFill>
  );
};

/* ========== V2 Finale · 12.5s ========== */
export const Finale: React.FC = () => {
  const f = useF();
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 36, color: C.dim, letterSpacing: 6, opacity: anim(f, 9, 12), fontFamily: HEI }}>
          从提问到判决书 · 多模型交叉 · 每一步留痕
        </div>
        <div style={{ fontSize: 100, fontWeight: 900, fontFamily: KAI, marginTop: 30, position: "relative", display: "inline-block" }}>
          {Array.from("让 AI 用研究者的方式说话").map((ch, i) => (
            <span key={i} style={{ opacity: anim(f, 33 + i * 4, 8), display: "inline-block", transform: `translateY(${(1 - anim(f, 33 + i * 4, 8)) * 30}px)` }}>
              {ch === " " ? "\u00A0" : ch}
            </span>
          ))}
          <HandUnderline at={80} w={1300} color={C.red} thickness={11} style={{ left: 10, top: 130 }} />
        </div>
        <div style={{ fontSize: 60, fontWeight: 900, fontFamily: KAI, marginTop: 50, opacity: anim(f, 126, 14) }}>
          Edu<span style={{ color: C.red }}>Evidence</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
