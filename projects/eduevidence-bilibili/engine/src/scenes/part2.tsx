import React from "react";
import { AbsoluteFill } from "remotion";
import {
  C, KAI, HEI, MONO, Kicker, StickyNote, Stamp, HandCircle, HandUnderline,
  Typewriter, HandCheck, NoteLine, anim, useF,
} from "../kit";

/* ========== S5 Case · 44.5s ========== */
const ROWS = [
  { ev: "E-001 · E-006", tx: "训练期间：任务完成速度提升 · 正确率", vv: "1.8×", color: C.green, at: 246 },
  { ev: "E-004", tx: "不设防使用，撤掉 AI 后：独立考试", vv: "−17%", color: C.red, at: 480 },
  { ev: "E-005", tx: "加上护栏：AI 只给提示、不给答案 → 负面影响基本消失", vv: "护栏 ✓", color: C.orange, at: 714 },
];
export const Case: React.FC = () => {
  const f = useF();
  return (
    <AbsoluteFill style={{ padding: "110px 130px" }}>
      <div style={{ fontSize: 52, fontWeight: 900, fontFamily: KAI, opacity: anim(f, 24, 16) }}>
        真实案例：大一 C 语言课，该不该允许 <span style={{ color: C.red }}>AI 编程助手</span>？
      </div>
      {/* 八智能体点 */}
      <div style={{ display: "flex", gap: 14, marginTop: 30 }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} style={{ width: 22, height: 22, borderRadius: "50%", background: anim(f, 126 + i * 9, 8) > 0.5 ? C.blue : "#D8D2C4" }} />
        ))}
        <div style={{ fontSize: 26, color: C.dim, marginLeft: 14, opacity: anim(f, 210, 12), fontFamily: HEI }}>8 个智能体协作</div>
      </div>
      {/* 证据行（横线画出） */}
      <div style={{ marginTop: 50 }}>
        {ROWS.map((r, i) => (
          <div key={r.ev} style={{ position: "relative", marginBottom: 8 }}>
            <NoteLine at={r.at} w={1660} rows={1} />
            <div style={{ display: "flex", alignItems: "center", gap: 34, padding: "18px 10px", opacity: anim(f, r.at + 10, 14) }}>
              <div style={{ fontSize: 29, fontWeight: 700, color: C.dim, minWidth: 230, fontFamily: MONO }}>{r.ev}</div>
              <div style={{ fontSize: 36, fontWeight: 700, flex: 1, fontFamily: HEI }}>{r.tx}</div>
              <div style={{ fontSize: 58, fontWeight: 900, fontFamily: KAI, color: r.color, position: "relative" }}>
                {r.vv}
                {i === 1 && f >= 500 ? <HandCircle at={500} w={200} h={90} style={{ left: -30, top: -34 }} /> : null}
              </div>
            </div>
          </div>
        ))}
      </div>
      {/* 冲突行 */}
      <div style={{ marginTop: 20, opacity: anim(f, 882, 18), fontSize: 38, fontWeight: 700, fontFamily: HEI }}>
        <span style={{ color: C.dim, fontFamily: MONO, fontSize: 30, marginRight: 30 }}>为什么打架？</span>
        有人测的是 <b style={{ color: C.blue }}>做题</b>，有人测的是 <b style={{ color: C.red }}>学习</b>
      </div>
      {/* 判决 */}
      <div style={{ marginTop: 44, display: "flex", alignItems: "center", gap: 44 }}>
        <Stamp at={1050} text="判决：PILOT · 试点" size={56} color={C.blue} />
        <div style={{ fontSize: 34, color: C.dim, fontWeight: 700, opacity: anim(f, 1080, 14), fontFamily: HEI }}>
          附完整教学干预方案 + 评估方案
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ========== S6 Outcome · 22s ========== */
const QUAD = [
  { t: "学习", s: "知识增长 · 理解 · 保持 · 迁移", c: C.green, note: C.noteG },
  { t: "任务", s: "完成时间 · 正确率 · 代码质量", c: C.blue, note: C.noteB },
  { t: "过程", s: "参与度 · 动机 · 认知负荷", c: C.orange, note: C.noteY },
  { t: "风险", s: "AI 依赖 · 过度依赖 · 诚信风险", c: C.red, note: C.noteR },
];
export const Outcome: React.FC = () => {
  const f = useF();
  return (
    <AbsoluteFill style={{ padding: "110px 130px" }}>
      <Kicker at={15} text="核心概念 · 结果分离" />
      <div style={{ display: "flex", gap: 0, marginTop: 20 }}>
        {["做题快 ≠ 学会了", "分数涨 ≠ 记得住"].map((t, i) => (
          <div key={t} style={{ flex: 1, background: "#fff", border: "2.5px solid #C9BFA5", padding: "32px 40px", fontSize: 52, fontWeight: 900, fontFamily: KAI, textAlign: "center", opacity: anim(f, 39 + i * 14, 16), transform: `translateX(${(i === 0 ? -1 : 1) * (1 - anim(f, 39 + i * 14, 16)) * 300}px) rotate(${i === 0 ? -1 : 1}deg)` }}>
            {t.split("≠")[0]}<span style={{ color: C.red }}>≠</span>{t.split("≠")[1]}
          </div>
        ))}
      </div>
      <div style={{ position: "relative", marginTop: 56 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px 420px" }}>
          {QUAD.map((q, i) => (
            <StickyNote key={q.t} delay={219 + i * 20} rotate={[-1.5, 1.2, -1, 1.6][i]} color={q.note} style={{ position: "relative", width: 560 }}>
              <div style={{ fontSize: 36, fontWeight: 900, fontFamily: KAI, color: q.c }}>{q.t}</div>
              <div style={{ fontSize: 27, color: C.dim, marginTop: 8, fontFamily: HEI }}>{q.s}</div>
            </StickyNote>
          ))}
        </div>
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)" }}>
          <Stamp at={327} text="20 种" sub="结果类型 · 四大类" size={62} color={C.blue} />
        </div>
      </div>
      <div style={{ marginTop: 60, position: "relative", textAlign: "center" }}>
        <div style={{ fontSize: 62, fontWeight: 900, fontFamily: KAI, opacity: anim(f, 513, 18), display: "inline-block", padding: "0 40px" }}>
          你提升的，到底是<span style={{ color: C.red }}>哪一个</span>？
        </div>
        <HandCircle at={528} w={780} h={110} style={{ left: "50%", marginLeft: -430, top: -24 }} />
      </div>
    </AbsoluteFill>
  );
};

/* ========== S7 Verdict · 16.5s ========== */
export const Verdict: React.FC = () => {
  const f = useF();
  return (
    <AbsoluteFill style={{ padding: "110px 130px" }}>
      <Kicker at={15} text="它的答案，从来不是「能用 / 不能用」" />
      <div style={{ display: "flex", gap: 40, marginTop: 60 }}>
        {[
          { zh: "采用", en: "ADOPT", c: C.green },
          { zh: "试点", en: "PILOT", c: C.blue },
          { zh: "拒绝", en: "REJECT", c: C.red },
          { zh: "证据不足", en: "INSUFFICIENT", c: C.orange },
        ].map((v, i) => (
          <div key={v.zh} style={{ flex: 1, textAlign: "center" }}>
            <Stamp at={39 + i * 96} text={v.zh} sub={v.en} size={54} color={v.c}
              style={{ width: "100%", display: "block" }} />
          </div>
        ))}
      </div>
      <div style={{ marginTop: 110, textAlign: "center", position: "relative" }}>
        <div style={{ fontSize: 58, fontWeight: 900, fontFamily: KAI, opacity: anim(f, 400, 18) }}>
          敢说<span style={{ color: C.orange }}>「证据不足」</span>，才是专业的开始
        </div>
        <HandUnderline at={418} w={1080} color={C.orange} style={{ left: "50%", marginLeft: -540, top: 78 }} />
      </div>
    </AbsoluteFill>
  );
};

/* ========== S8 Terminal · 16.5s ========== */
export const Terminal: React.FC = () => {
  const f = useF();
  return (
    <AbsoluteFill style={{ padding: "110px 130px", justifyContent: "center" }}>
      {/* 终端窗 = 贴在笔记本上的截图 */}
      <div style={{ position: "relative", transform: "rotate(-0.8deg)" }}>
        <TapeAbs />
        <div style={{ background: "#101623", borderRadius: 20, overflow: "hidden", border: "3px solid #C9BFA5", boxShadow: "0 26px 60px rgba(60,50,30,0.28)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "18px 26px", background: "rgba(148,163,184,0.14)" }}>
            {["#F87171", "#FBBF24", "#34D399"].map((c) => (
              <div key={c} style={{ width: 18, height: 18, borderRadius: "50%", background: c }} />
            ))}
            <span style={{ marginLeft: 16, fontSize: 24, color: "#94a3b8", fontFamily: MONO }}>eduevidence — 安装与使用</span>
          </div>
          <div style={{ padding: "40px 50px 54px", display: "flex", flexDirection: "column", gap: 28 }}>
            <Typewriter at={54} text="$ git clone github.com/37chengshan/eduevidence" cps={15} fontSize={34} color="#E2E8F0" cursorUntil={200} />
            <Typewriter at={168} text="$ bash install.sh --skill" cps={15} fontSize={34} color="#E2E8F0" cursorUntil={280} />
            <div style={{ position: "relative", opacity: anim(f, 252, 12) }}>
              <span style={{ fontSize: 34, color: "#34D399", fontFamily: MONO, fontWeight: 700 }}>✓ 已装入你的 AI 助手</span>
              <HandCheck at={258} size={70} style={{ left: -14, top: -22 }} />
            </div>
            <Typewriter at={294} text="你：作业该不该允许用 AI？" cps={13} fontSize={34} color="#C4B5FD" cursor={false} weight={700} />
            <Typewriter at={356} text="AI：自动走完证据流 → 生成判决书报告" cps={13} fontSize={34} color="#E2E8F0" cursor={false} />
            <div style={{ display: "flex", gap: 22, opacity: anim(f, 418, 14) }}>
              {["报告 · 判决 PILOT", "教学干预 ✓", "评估方案 ✓"].map((t, i) => (
                <span key={t} style={{ background: [C.noteB, C.noteG, C.noteY][i], padding: "10px 28px", fontSize: 28, fontWeight: 700, transform: `rotate(${[-1.5, 1, -1][i]}deg)`, fontFamily: HEI }}>{t}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const TapeAbs: React.FC = () => (
  <>
    <div style={{ position: "absolute", left: 120, top: -22, width: 180, height: 44, background: "rgba(255,214,102,0.78)", transform: "rotate(-5deg)", zIndex: 5 }} />
    <div style={{ position: "absolute", right: 120, top: -22, width: 180, height: 44, background: "rgba(255,214,102,0.78)", transform: "rotate(4deg)", zIndex: 5 }} />
  </>
);
