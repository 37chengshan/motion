import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
} from "remotion";
import {
  C, KAI, HEI, MONO, Paper, Kicker, StickyNote, Tape, Stamp, HandCircle,
  HandUnderline, Typewriter, Highlight, RulerAxis, PageFlip, anim, useF,
} from "../kit";

/* ========== S1 Hook · 31s ========== */
export const Hook: React.FC = () => {
  const f = useF();
  const titleIn = spring({ frame: f - 735, fps: 30, config: { damping: 14 } });
  return (
    <AbsoluteFill style={{ padding: "110px 130px" }}>
      <Kicker at={15} text="2023 · CHI 计算机顶会 · 真实研究" />
      {/* 便利贴：做题速度 */}
      <StickyNote delay={75} rotate={-2} color={C.noteY} style={{ left: 150, top: 300, width: 480 }}>
        <div style={{ fontSize: 34, color: C.dim, fontFamily: HEI }}>做题速度</div>
        <div style={{ fontSize: 96, fontWeight: 900, fontFamily: KAI, color: C.orange }}>↑ 提升</div>
      </StickyNote>
      {/* 便利贴：正确率 1.8× */}
      <div style={{ position: "absolute", left: 720, top: 300 }}>
        <StickyNote delay={195} rotate={1.6} color={C.noteG} style={{ position: "relative", width: 480 }}>
          <div style={{ fontSize: 34, color: C.dim, fontFamily: HEI }}>正确率</div>
          <div style={{ fontSize: 110, fontWeight: 900, fontFamily: KAI, color: C.green }}>1.8×</div>
        </StickyNote>
        <HandCircle at={225} dur={30} w={430} h={150} style={{ left: 20, top: 30 }} />
      </div>
      {/* 一周后印章 */}
      <div style={{ position: "absolute", left: 150, top: 590 }}>
        <Stamp at={417} text="一周后再测：无显著差异" size={46} />
      </div>
      {/* 结论 */}
      <div style={{ position: "absolute", left: 150, top: 740 }}>
        <div style={{ fontSize: 78, fontWeight: 900, fontFamily: KAI, opacity: anim(f, 618, 20) }}>
          做得快 <span style={{ color: C.red }}>≠</span> 学会了
        </div>
        <HandUnderline at={640} w={760} color={C.red} style={{ top: 88 }} />
      </div>
      {/* 标题卡（结尾） */}
      <AbsoluteFill style={{ background: C.paper, opacity: titleIn, justifyContent: "center", alignItems: "center", display: titleIn > 0.01 ? "flex" : "none" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 150, fontWeight: 900, fontFamily: KAI }}>
            Edu<span style={{ color: C.red }}>Evidence</span>
          </div>
          <div style={{ fontSize: 44, color: C.dim, marginTop: 18, fontFamily: HEI }}>让 AI 回答教育问题之前，先拿出证据</div>
          <div style={{ display: "flex", gap: 26, justifyContent: "center", marginTop: 44 }}>
            {["完全开源", "AI Agent 技能", "循证决策"].map((t, i) => (
              <div key={t} style={{ background: [C.noteG, C.noteB, C.noteY][i], padding: "14px 36px", fontSize: 32, fontWeight: 700, transform: `rotate(${[-1.5, 1, -0.8][i]}deg)`, boxShadow: "0 8px 18px rgba(60,50,30,0.14)" }}>
                {t}
              </div>
            ))}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ========== S2 Pain · 33.5s ========== */
const Q = "老师问 AI：该不该让学生用 AI 编程助手？";
export const Pain: React.FC = () => {
  const f = useF();
  const fly = (d: number) => spring({ frame: f - d, fps: 30, config: { damping: 12 } });
  return (
    <AbsoluteFill style={{ padding: "110px 130px" }}>
      <Kicker at={18} text="熟悉的一幕" />
      {/* 提问：逐字打出 */}
      <div style={{ display: "flex", alignItems: "center", gap: 26, marginTop: 20 }}>
        <div style={{ width: 86, height: 86, borderRadius: "50%", background: "linear-gradient(135deg,#F5B840,#E8843C)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, fontWeight: 900, color: "#fff", fontFamily: KAI }}>师</div>
        <Typewriter at={30} text={Q} cps={13} fontSize={46} style={{ fontWeight: 700, fontFamily: KAI }} cursorUntil={110} />
      </div>
      {/* AI 流水线纸团 */}
      <div style={{ display: "flex", alignItems: "center", gap: 30, marginTop: 66 }}>
        {["搜索资料", "总结观点", "给出一堆建议"].map((t, i) => (
          <React.Fragment key={t}>
            {i > 0 && <div style={{ fontSize: 52, color: C.blue, fontWeight: 900, opacity: anim(f, 168 + i * 20, 10) }}>→</div>}
            <div style={{ transform: `rotate(${fly(160 + i * 20) * (i % 2 === 0 ? -2 : 2)}deg) scale(${fly(160 + i * 20)})`, opacity: fly(160 + i * 20), background: "#fff", border: "2.5px solid #C9BFA5", padding: "26px 46px", fontSize: 40, fontWeight: 700, boxShadow: "0 10px 22px rgba(60,50,30,0.12)" }}>
              {t}
            </div>
          </React.Fragment>
        ))}
      </div>
      {/* 三个问号章 */}
      <div style={{ display: "flex", gap: 40, marginTop: 70 }}>
        {["有证据吗？", "靠得住吗？", "适合你的学生吗？"].map((t, i) => (
          <Stamp key={t} at={430 + i * 55} text={t} size={40} color={C.red} style={{ transform: `rotate(${[-3, 2, -2][i]}deg)` }} />
        ))}
      </div>
      {/* 分屏 */}
      <div style={{ display: "flex", gap: 0, marginTop: 66, width: "100%" }}>
        <div style={{ flex: 1, background: C.noteG, padding: "30px 40px", fontSize: 40, fontWeight: 800, borderRadius: "18px 0 0 18px", transform: `translateX(${(1 - fly(660)) * -400}px)`, opacity: fly(660), fontFamily: KAI }}>
          研究发现 ✓
        </div>
        <div style={{ flex: 1, background: C.noteR, padding: "30px 40px", fontSize: 40, fontWeight: 800, borderRadius: "0 18px 18px 0", transform: `translateX(${(1 - fly(666)) * 400}px)`, opacity: fly(666), fontFamily: KAI }}>
          AI 现编 ✕
        </div>
      </div>
      <div style={{ marginTop: 60, position: "relative" }}>
        <div style={{ fontSize: 58, fontWeight: 900, fontFamily: KAI, opacity: anim(f, 870, 20) }}>
          教育决策，赌的是真实学生的<span style={{ color: C.red }}>时间</span>
        </div>
        <Highlight at={890} w={1120} h={30} style={{ top: 66, left: 6 }} />
      </div>
    </AbsoluteFill>
  );
};

/* ========== S3 Intro · 20.5s ========== */
export const Intro: React.FC = () => {
  const f = useF();
  const pop = spring({ frame: f - 30, fps: 30, config: { damping: 13 } });
  return (
    <AbsoluteFill style={{ padding: "110px 130px", alignItems: "center" }}>
      <PageFlip at={0} />
      <div style={{ textAlign: "center", transform: `scale(${pop})`, marginTop: 60 }}>
        <div style={{ fontSize: 150, fontWeight: 900, fontFamily: KAI }}>
          Edu<span style={{ color: C.red }}>Evidence</span>
        </div>
        <div style={{ fontSize: 46, letterSpacing: 14, color: C.dim, marginTop: 14, fontFamily: HEI }}>循证教育决策引擎</div>
      </div>
      <div style={{ position: "absolute", top: 620 }}>
        <StickyNote delay={255} rotate={1.8} color={C.noteB} style={{ position: "relative", fontSize: 38, fontWeight: 700, fontFamily: HEI }}>
          形态：AI Agent 技能 · 装进你的 AI 助手
        </StickyNote>
      </div>
      <div style={{ position: "absolute", top: 790, display: "flex", gap: 22 }}>
        {["Claude Code", "ZCode", "Codex", "OpenCode", "Kimi · Cline …"].map((t, i) => (
          <div key={t} style={{ background: "#fff", border: "2px solid #C9BFA5", padding: "12px 30px", fontSize: 30, fontWeight: 700, opacity: anim(f, 282 + i * 15, 12), transform: `rotate(${[-1.5, 1.2, -0.8, 1.6, -1][i]}deg)` }}>
            {t}
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", top: 910, textAlign: "center", width: "100%" }}>
        <div style={{ fontSize: 66, fontWeight: 900, fontFamily: KAI, position: "relative", display: "inline-block" }}>
          <span style={{ color: C.blue }}>先摆证据，</span><span style={{ color: C.red }}>再下判决</span>
          <HandUnderline at={480} w={620} color={C.red} style={{ left: 30, top: 78 }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ========== S4 Flow · 56s ========== */
const STEPS = ["定框", "检索", "抽取", "怀疑者", "审计", "法庭", "适用", "干预", "评估"];
const FlowPanel: React.FC<{ at: number; title: string; children: React.ReactNode; out?: number }> = ({ at, title, children, out }) => {
  const f = useF();
  const visIn = anim(f, at * 30, 14);
  const visOut = out !== undefined ? 1 - anim(f, out * 30, 12) : 1;
  if (f < at * 30 || (out !== undefined && f >= out * 30 + 12)) return null;
  return (
    <div style={{ position: "absolute", left: 130, right: 130, top: 430, background: "#fff", border: "2.5px solid #C9BFA5", borderRadius: 20, padding: "40px 54px", opacity: visIn * visOut, transform: `translateY(${(1 - visIn) * 40}px)` }}>
      <div style={{ fontSize: 42, fontWeight: 900, fontFamily: KAI, marginBottom: 22 }}>{title}</div>
      {children}
    </div>
  );
};
export const Flow: React.FC = () => {
  const f = useF();
  return (
    <AbsoluteFill style={{ padding: "185px 130px" }}>
      <Kicker at={15} text="工作原理 · 证据流九步" />
      <RulerAxis
        slideAt={30}
        morphAt={135}
        w={1660}
        ticks={STEPS.map((s, i) => ({ label: `${i + 1} ${s}`, at: i / 8 }))}
      >
        {STEPS.map((s, i) => (
          <div key={s} style={{ position: "absolute", left: (i / 8) * 1620 + 20 - 40, top: -92, opacity: anim(f, 126 + i * 6, 12) }}>
            <div style={{ width: 74, height: 74, borderRadius: "50%", border: `4px solid ${i < 3 ? C.blue : i < 6 ? C.red : C.green}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 38, fontWeight: 900, fontFamily: KAI, background: "#fff", transform: `rotate(${[-4, 3, -2, 5, -3, 2, -5, 3, -2][i]}deg)` }}>
              {i + 1}
            </div>
          </div>
        ))}
      </RulerAxis>
      {/* 面板区 */}
      <FlowPanel at={4.2} out={10.0} title="① 定框 Frame">
        <div style={{ display: "flex", gap: 20 }}>
          {["学习者", "干预", "对照", "结果", "情境"].map((t, i) => (
            <div key={t} style={{ background: C.noteB, padding: "14px 32px", fontSize: 32, fontWeight: 700, transform: `rotate(${[-2, 1.5, -1, 2, -1.5][i]}deg)`, opacity: anim(f, 135 + i * 6, 10) }}>
              {t}
            </div>
          ))}
        </div>
      </FlowPanel>
      <FlowPanel at={10.4} out={17.0} title="② 检索 Retrieve —— 反方证据是强制的">
        <div style={{ display: "flex", gap: 30 }}>
          <div style={{ flex: 1, background: C.noteG, padding: 26, fontSize: 33, fontWeight: 700, transform: "rotate(-1deg)" }}>支持证据 ✓ 速度 / 正确率 / 参与度</div>
          <div style={{ flex: 1, background: C.noteR, padding: 26, fontSize: 33, fontWeight: 700, transform: "rotate(1.2deg)" }}>反方证据 ✕ 无效 · 负面 · 打脸的，全都要</div>
        </div>
      </FlowPanel>
      <FlowPanel at={17.4} out={23.0} title="③ 抽取 Extract">
        <div style={{ fontSize: 33, color: C.dim, marginBottom: 18 }}>每一条证据，绑定到具体的结果类型上</div>
        <div style={{ display: "flex", gap: 20, alignItems: "center", fontSize: 32, fontWeight: 700 }}>
          <span style={{ background: "#fff", border: "2px solid #C9BFA5", padding: "10px 26px" }}>E-004</span><span>→</span><span style={{ background: C.noteB, padding: "10px 26px" }}>独立问题解决</span>
          <span style={{ background: "#fff", border: "2px solid #C9BFA5", padding: "10px 26px" }}>E-006</span><span>→</span><span style={{ background: C.noteG, padding: "10px 26px" }}>任务正确率</span>
        </div>
      </FlowPanel>
      <FlowPanel at={23.2} out={30.0} title="④ 怀疑者协议 —— 专职杠精 Agent，九项固定检查">
        <div style={{ display: "flex", gap: 16 }}>
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} style={{ width: 60, height: 60, borderRadius: "50%", border: `4px solid ${C.red}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, fontWeight: 900, color: C.red, opacity: anim(f, 705 + i * 8, 8), transform: `rotate(${(i % 3 - 1) * 6}deg)` }}>
              {i + 1}
            </div>
          ))}
        </div>
      </FlowPanel>
      <FlowPanel at={30.4} out={36.2} title="⑤ 方法学审计 —— 十五项清单">
        <div style={{ position: "relative", width: 1100, height: 34, background: "#EFE9DA", borderRadius: 17, overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, background: C.yellow, transformOrigin: "left center", transform: `scaleX(${anim(f, 922, 70)})` }} />
        </div>
        <div style={{ fontSize: 32, fontWeight: 900, color: C.green, marginTop: 16, opacity: anim(f, 990, 10) }}>15 / 15 ✓</div>
      </FlowPanel>
      <FlowPanel at={36.6} out={43.0} title="⑥ 证据法庭 —— 像法官一样裁决">
        <svg width="1500" height="150" viewBox="0 0 1500 150">
          {(() => {
            const p = (a: number, b: number) => anim(f, a, b * 30);
            const p1 = p(1102, 0.5), p2 = p(1102, 0.9);
            return (
              <g stroke={C.ink} strokeWidth={7} strokeLinecap="round" fill="none">
                <path d="M 750 20 L 750 90" strokeDasharray={80} strokeDashoffset={80 * (1 - p1)} />
                <path d="M 480 90 L 1020 90" strokeDasharray={560} strokeDashoffset={560 * (1 - p1)} />
                <path d="M 480 90 L 430 130 M 1020 90 L 1070 130" strokeDasharray={140} strokeDashoffset={140 * (1 - p2)} />
                <path d="M 480 60 Q 555 95 630 60" strokeDasharray={180} strokeDashoffset={180 * (1 - p2)} opacity={0.8} />
                <path d="M 870 60 Q 945 25 1020 60" strokeDasharray={180} strokeDashoffset={180 * (1 - p2)} opacity={0.8} />
              </g>
            );
          })()}
          <text x={330} y={70} fontSize={30} fontWeight={700} fill={C.green} fontFamily={KAI}>成立 ✓</text>
          <text x={1090} y={70} fontSize={30} fontWeight={700} fill={C.red} fontFamily={KAI}>被反驳 ✕</text>
          <text x={640} y={145} fontSize={30} fontWeight={700} fill={C.orange} fontFamily={KAI}>证据不足 ？</text>
        </svg>
      </FlowPanel>
      <FlowPanel at={43.4} out={52.0} title="⑦⑧⑨ 落地：证据 → 行动">
        <div style={{ display: "flex", gap: 24, alignItems: "center", fontSize: 33, fontWeight: 700 }}>
          {["适用性分析", "最小可行试点", "评估方案"].map((t, i) => (
            <React.Fragment key={t}>
              {i > 0 && <span style={{ fontSize: 44, color: C.blue }}>→</span>}
              <span style={{ background: [C.noteB, C.noteG, C.noteY][i], padding: "14px 34px", transform: `rotate(${[-1.5, 1, -1][i]}deg)` }}>{t}</span>
            </React.Fragment>
          ))}
        </div>
      </FlowPanel>
      <div style={{ position: "absolute", left: 130, right: 130, top: 430, display: "flex", justifyContent: "center" }}>
        <Stamp at={1590} text="⚠ 永远不会替你直接全量上线" size={44} color={C.orange} />
      </div>
    </AbsoluteFill>
  );
};
