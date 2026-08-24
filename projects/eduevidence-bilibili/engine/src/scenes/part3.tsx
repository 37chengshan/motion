import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, staticFile, interpolate } from "remotion";
import {
  C, KAI, HEI, MONO, Kicker, Tape, Stamp, HandUnderline, Typewriter,
  HandCheck, NoteLine, anim, useF,
} from "../kit";
import chartData from "../../../refs/chart-data.json";

/* ========== WebTour · 21.5s（V1）/ 64s（V2）========== */
export const WebTour: React.FC<{ long?: boolean; videoDur?: number }> = ({ long = false, videoDur = 21 }) => {
  const f = useF();
  const endHold = long ? anim(f, 56.3 * 30, 10) : 0;
  return (
    <AbsoluteFill style={{ padding: "116px 130px 70px", justifyContent: "center" }}>
      <Kicker at={9} text={long ? "实拍 · 官方主页（完整漫游）" : "实拍 · 官方主页"} />
      <div style={{ position: "relative", transform: "rotate(-0.9deg)" }}>
        <div style={{ position: "absolute", left: 140, top: -24, width: 190, height: 46, background: "rgba(255,214,102,0.78)", transform: "rotate(-4deg)", zIndex: 5 }} />
        <div style={{ position: "absolute", right: 140, top: -24, width: 190, height: 46, background: "rgba(255,214,102,0.78)", transform: "rotate(5deg)", zIndex: 5 }} />
        {/* 浏览器照片卡 */}
        <div style={{ background: "#fff", padding: 14, borderRadius: 14, border: "2.5px solid #C9BFA5", boxShadow: "0 30px 70px rgba(60,50,30,0.3)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 18px 14px" }}>
            {["#F87171", "#FBBF24", "#34D399"].map((c) => (
              <div key={c} style={{ width: 16, height: 16, borderRadius: "50%", background: c }} />
            ))}
            <span style={{ marginLeft: 14, fontSize: 23, color: C.dim, fontFamily: MONO, background: "#F1EDE2", borderRadius: 999, padding: "6px 24px" }}>
              github.com/37chengshan/eduevidence
            </span>
          </div>
          <div style={{ position: "relative", height: 780, overflow: "hidden", borderRadius: 8, background: "#FDFBF4" }}>
            <OffthreadVideo
              src={staticFile("assets/landing-fast60.mp4")}
              startFrom={0}
              endAt={videoDur * 60}
              style={{ position: "absolute", left: 0, top: 0, width: 1560 }}
            />
            {long ? (
              <Img src={staticFile("assets/landing-end.png")} style={{ position: "absolute", left: 0, top: 0, width: 1560, opacity: endHold }} />
            ) : null}
          </div>
        </div>
        {/* 手写批注 */}
        <div style={{ position: "absolute", right: -20, top: 60, transform: "rotate(3deg)", opacity: anim(f, 90, 14) }}>
          <div style={{ fontSize: 34, fontWeight: 700, fontFamily: KAI, color: C.red }}>滚动浏览中 ↘</div>
          <svg width={120} height={90} viewBox="0 0 120 90">
            <path d="M 100 10 C 60 30, 40 55, 20 80" stroke={C.red} strokeWidth={6} fill="none" strokeLinecap="round" strokeDasharray={130} strokeDashoffset={130 * (1 - anim(f, 105, 14))} />
            <path d="M 20 80 L 38 70 M 20 80 L 34 62" stroke={C.red} strokeWidth={6} fill="none" strokeLinecap="round" opacity={anim(f, 118, 8)} />
          </svg>
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ========== ReportCards · 23.5s ========== */
const THEMES = [
  { img: "theme-academic", label: "学术 Academic", r: -6 },
  { img: "theme-claude", label: "Claude Research", r: -3 },
  { img: "theme-datalab", label: "DataLab Light", r: 0 },
  { img: "theme-datalab-dark", label: "DataLab Dark", r: 3 },
  { img: "theme-presentation", label: "演示 Presentation", r: 6 },
];
export const ReportCards: React.FC = () => {
  const f = useF();
  return (
    <AbsoluteFill style={{ padding: "116px 130px 70px" }}>
      <Kicker at={9} text="同一份判决书 · 五种报告风格" />
      <div style={{ position: "relative", height: 700, marginTop: 30 }}>
        {THEMES.map((t, i) => {
          const at = 306 + i * 21;
          const p = anim(f, at, 16);
          const lift = anim(f, 537 + i * 13, 16) * anim(f, 553 + i * 13, 16, 1, 0);
          if (f < at) return null;
          return (
            <div
              key={t.img}
              style={{
                position: "absolute",
                left: `calc(50% - 240px + ${(i - 2) * 330}px)`,
                bottom: 40,
                width: 480,
                transform: `rotate(${t.r}deg) translateY(${(1 - p) * 200}px) translateY(${-lift * 26}px) scale(${0.9 + p * 0.1 + lift * 0.05})`,
                opacity: p,
                transformOrigin: "bottom center",
              }}
            >
              <div style={{ background: "#fff", padding: 12, paddingBottom: 0, borderRadius: 10, border: "2.5px solid #C9BFA5", boxShadow: "0 20px 44px rgba(60,50,30,0.25)" }}>
                <Img src={staticFile(`assets/${t.img}.png`)} style={{ width: "100%", height: 270, objectFit: "cover", objectPosition: "top", borderRadius: 6 }} />
                <div style={{ textAlign: "center", padding: "14px 0 16px", fontSize: 27, fontWeight: 700, fontFamily: HEI }}>{t.label}</div>
              </div>
              <Tape style={{ left: "50%", marginLeft: -70, top: -18, transform: "rotate(-3deg)" }} />
            </div>
          );
        })}
      </div>
      <div style={{ textAlign: "center", marginTop: 20 }}>
        <Stamp at={468} text="一键切换风格 · 判决内容不变" size={38} color={C.blue} />
      </div>
    </AbsoluteFill>
  );
};

/* ========== Viz · 41.5s ========== 手帐化三图表 */
const FOREST = chartData.forest as {
  sid: string; outcome: string; g: number; lo: number; hi: number; dir: string;
}[];
const OUTCOMES = chartData.outcomes as { outcome_type: string; positive_count: number; negative_count: number; null_count: number }[];
const CLAIMS = chartData.claims as { id: string; outcome: string; n: number; ev: string[] }[];
const OUTZH: Record<string, string> = {
  completion_time: "完成速度", concept_understanding: "概念理解", retention: "长期保持",
  transfer: "迁移", assignment_score: "作业分数", independent_problem_solving: "独立解题",
  knowledge_gain: "知识增益", engagement: "参与度", ai_dependency: "AI 依赖", code_quality: "代码质量",
};

const Panel: React.FC<{ at: number; out?: number; children: React.ReactNode }> = ({ at, out, children }) => {
  const f = useF();
  const vin = anim(f, at * 30, 12);
  const vout = out !== undefined ? anim(f, out * 30, 12) : 0;
  if (f < at * 30 || (out !== undefined && f >= out * 30 + 12)) return null;
  return (
    <div style={{ position: "absolute", inset: 0, background: "#fff", border: "2.5px solid #C9BFA5", borderRadius: 20, padding: "34px 46px", opacity: vin * (1 - vout), transform: `translateX(${(1 - vin) * 60 - vout * 60}px)` }}>
      {children}
    </div>
  );
};

export const Viz: React.FC = () => {
  const f = useF();
  const X0 = 560, X1 = 1440, GMIN = -0.7, GMAX = 1.1;
  const X = (g: number) => X0 + ((g - GMIN) / (GMAX - GMIN)) * (X1 - X0);
  return (
    <AbsoluteFill style={{ padding: "116px 130px 60px" }}>
      <Kicker at={9} text="数据可视化 · 报告内图表（全部会动）" />
      <div style={{ position: "relative", height: 780 }}>
        {/* 图1 森林图 */}
        <Panel at={0.5} out={15.2}>
          <div style={{ fontSize: 38, fontWeight: 900, fontFamily: KAI }}>16 项实证 · 效应量森林图</div>
          <div style={{ fontSize: 24, color: C.dim, marginBottom: 14 }}>Hedges' g 与 95% 置信区间 · 正绿 负橙 跨零灰</div>
          <svg width={1560} height={620} viewBox="0 0 1560 620">
            {[[-0.5, "-0.5"], [0, "0.0"], [0.5, "+0.5"], [1.0, "+1.0"]].map(([g, lb]) => (
              <g key={lb as string}>
                <line x1={X(g as number)} y1={20} x2={X(g as number)} y2={540} stroke="rgba(60,50,30,0.14)" strokeWidth={2}
                  style={{ opacity: anim(f, 30, 10) }} />
                <text x={X(g as number)} y={572} fontSize={20} fill={C.dim} textAnchor="middle" fontFamily={MONO}
                  style={{ opacity: anim(f, 34, 10) }}>{lb}</text>
              </g>
            ))}
            <line x1={X(0)} y1={20} x2={X(0)} y2={540} stroke={C.dim} strokeWidth={2.5} strokeDasharray="8 8"
              style={{ transform: `scaleY(${anim(f, 22, 12)})`, transformOrigin: "center", transformBox: "fill-box" }} />
            {FOREST.map((r, i) => {
              const y = 34 + i * 31;
              const at = 45 + i * 8;
              const p = anim(f, at, 11);
              const col = r.dir === "positive" ? C.green : r.dir === "negative" ? C.red : "#9a958a";
              if (f < at) return null;
              return (
                <g key={r.sid}>
                  {r.dir === "negative" ? (
                    <rect x={X0 - 10} y={y - 14} width={X1 - X0 + 20} height={28} fill="rgba(210,84,74,0.08)" opacity={anim(f, 890, 12)} />
                  ) : null}
                  <text x={4} y={y + 6} fontSize={17} fill={C.dim} fontFamily={MONO} opacity={anim(f, at - 4, 8)}>{r.sid}</text>
                  <text x={330} y={y + 6} fontSize={19} fill={C.ink} fontFamily={HEI} opacity={anim(f, at - 4, 8)}>{OUTZH[r.outcome] || r.outcome}</text>
                  <line x1={X(r.lo)} y1={y} x2={X(r.hi)} y2={y} stroke={col} strokeWidth={4} strokeLinecap="round"
                    strokeDasharray={X(r.hi) - X(r.lo)} strokeDashoffset={(X(r.hi) - X(r.lo)) * (1 - p)} />
                  <rect x={X(r.g) - 7} y={y - 7} width={14} height={14} rx={3} fill={col}
                    style={{ transform: `scale(${anim(f, at + 5, 8, 0, 1)})`, transformOrigin: `${X(r.g)}px ${y}px`, transformBox: "view-box" }} />
                  <text x={1470} y={y + 6} fontSize={18} fill={col} fontFamily={MONO} fontWeight={700} opacity={anim(f, at + 8, 8)}>
                    {(r.g >= 0 ? "+" : "") + r.g.toFixed(2)}
                  </text>
                </g>
              );
            })}
            <text x={1440} y={608} fontSize={22} fontWeight={700} fill={C.red} textAnchor="end" fontFamily={KAI}
              style={{ opacity: anim(f, 895, 12) }}>
              ⚠ 长期保持 · 3 项研究全部为负 —— 分歧所在
            </text>
          </svg>
        </Panel>
        {/* 图2 证据分布 */}
        <Panel at={15.6} out={23.2}>
          <div style={{ fontSize: 38, fontWeight: 900, fontFamily: KAI }}>证据按结果类型分布</div>
          <div style={{ fontSize: 24, color: C.dim, marginBottom: 20 }}>支持向右 · 反驳向左 · 存疑为灰圈（ai-coding 案例）</div>
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", left: 900, top: 0, width: 4, height: 560, background: C.dim, borderRadius: 2 }} />
            {OUTCOMES.map((o, i) => {
              const y = 20 + i * 68;
              const at = 480 + i * 9;
              return (
                <div key={o.outcome_type} style={{ position: "absolute", top: y, left: 0, width: "100%", height: 50 }}>
                  <div style={{ position: "absolute", right: 660, top: 6, fontSize: 28, fontWeight: 700, fontFamily: HEI, opacity: anim(f, at, 8) }}>
                    {OUTZH[o.outcome_type] || o.outcome_type}
                  </div>
                  {o.positive_count > 0 ? (
                    <div style={{ position: "absolute", left: 904, top: 4, width: o.positive_count * 150, height: 40, background: "rgba(123,160,91,0.85)", borderRadius: 20, transform: `scaleX(${anim(f, at + 4, 12)})`, transformOrigin: "left center" }} />
                  ) : null}
                  {o.negative_count > 0 ? (
                    <div style={{ position: "absolute", left: 896 - o.negative_count * 150, top: 4, width: o.negative_count * 150, height: 40, background: "rgba(210,84,74,0.85)", borderRadius: 20, transform: `scaleX(${anim(f, at + 6, 12)})`, transformOrigin: "right center" }} />
                  ) : null}
                  {o.null_count > 0 ? (
                    <div style={{ position: "absolute", left: 886, top: 8, width: 36, height: 36, borderRadius: "50%", border: `4px solid #9a958a`, opacity: anim(f, at + 8, 8) }} />
                  ) : null}
                </div>
              );
            })}
          </div>
        </Panel>
        {/* 图3 主张→证据追溯 */}
        <Panel at={23.6}>
          <div style={{ fontSize: 38, fontWeight: 900, fontFamily: KAI }}>主张 → 证据 全链路追溯</div>
          <div style={{ fontSize: 24, color: C.dim, marginBottom: 10 }}>每个结论都连着原始研究 · 4 主张 · 16 项证据</div>
          <svg width={1560} height={560} viewBox="0 0 1560 560">
            {CLAIMS.map((c, i) => {
              const at = 714 + i * 14;
              const y = 30 + i * 135;
              return (
                <g key={c.id} style={{ opacity: anim(f, at, 12) }}>
                  <rect x={20} y={y} width={470} height={92} rx={16} fill={C.noteB} stroke="rgba(91,141,184,0.6)" strokeWidth={2.5}
                    style={{ transform: `rotate(${[-1, 0.8, -0.6, 1][i]}deg)` }} />
                  <text x={44} y={y + 38} fontSize={24} fontWeight={800} fill={C.blue} fontFamily={MONO}>{c.id}</text>
                  <text x={44} y={y + 74} fontSize={27} fontWeight={700} fill={C.ink} fontFamily={KAI}>{OUTZH[c.outcome] || c.outcome} · {c.n} 项证据</text>
                </g>
              );
            })}
            {Array.from({ length: 16 }).map((_, j) => (
              <g key={j} style={{ opacity: anim(f, 726 + j * 5, 8) }}>
                <circle cx={1430} cy={26 + j * 34} r={8} fill={C.blue} />
                <text x={1410} y={32 + j * 34} fontSize={17} fill={C.dim} textAnchor="end" fontFamily={MONO}>
                  EV-{String(j + 1).padStart(3, "0")}
                </text>
              </g>
            ))}
            {CLAIMS.map((c, i) =>
              c.ev.map((evId, j) => {
                const idx = parseInt(evId.replace("EV-MATH-", ""), 10) - 1;
                const y1 = 30 + i * 135 + 46;
                const y2 = 26 + idx * 34;
                const at = 740 + i * 16 + j * 6;
                const d = `M 490 ${y1} C 800 ${y1}, 1100 ${y2}, 1418 ${y2}`;
                return (
                  <path key={evId} d={d} fill="none" stroke={C.blue} strokeWidth={2} opacity={0.42 * anim(f, at, 8)} />
                );
              })
            )}
          </svg>
        </Panel>
      </div>
      <div style={{ textAlign: "center", marginTop: 18 }}>
        <Stamp at={945} text="可视化不是装饰 · 它就是证据本身的样子" size={36} color={C.red} />
      </div>
    </AbsoluteFill>
  );
};

/* ========== OSS · 17s ========== */
export const OSS: React.FC = () => {
  const f = useF();
  return (
    <AbsoluteFill style={{ padding: "110px 130px", justifyContent: "center" }}>
      <div style={{ position: "relative", transform: "rotate(-0.8deg)" }}>
        <Tape style={{ left: "50%", marginLeft: -90, top: -22 }} />
        <div style={{ background: "#fff", border: "3px solid #C9BFA5", borderRadius: 24, padding: "64px 78px", boxShadow: "0 30px 70px rgba(60,50,30,0.25)", width: 1440 }}>
          <div style={{ fontSize: 54, fontWeight: 800, fontFamily: MONO, opacity: anim(f, 30, 12) }}>
            github.com/<span style={{ color: C.blue }}>37chengshan/eduevidence</span>
          </div>
          <div style={{ display: "flex", gap: 24, marginTop: 44 }}>
            {["完全开源", "免费", "零第三方依赖", "纯 Python 标准库"].map((t, i) => (
              <span key={t} style={{ background: [C.noteG, C.noteB, C.noteY, "#fff"][i], border: "2px solid #C9BFA5", padding: "12px 32px", fontSize: 30, fontWeight: 700, opacity: anim(f, 87 + i * 18, 12), transform: `rotate(${[-1.5, 1.2, -1, 1.6][i]}deg)`, fontFamily: HEI }}>
                {t}
              </span>
            ))}
          </div>
          <div style={{ marginTop: 46, opacity: anim(f, 237, 12) }}>
            <Typewriter at={237} text="$ bash install.sh --skill" cps={12} fontSize={40} color={C.green} weight={700} cursorUntil={330} />
          </div>
          <div style={{ fontSize: 44, fontWeight: 700, fontFamily: KAI, marginTop: 46, opacity: anim(f, 363, 16) }}>
            从今天起，让它用研究者的方式，回答教育问题
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ========== CTA · 18s ========== */
const Icon3: React.FC<{ at: number; kind: string }> = ({ at, kind }) => {
  const f = useF();
  const p1 = anim(f, at, 12);
  const p2 = anim(f, at + 10, 12);
  const p3 = anim(f, at + 20, 12);
  const paths: Record<string, string[]> = {
    like: ["M 20 70 L 20 35 L 45 12 Q 52 5 52 16 L 48 40 L 78 40 Q 88 40 84 52 L 72 78 Q 68 84 58 84 L 30 84 Q 20 84 20 70 Z"],
    coin: ["M 50 12 A 38 38 0 1 1 49 12 Z", "M 50 30 L 50 70 M 38 40 Q 50 32 62 40 Q 50 50 38 58"],
    fav: ["M 50 84 L 16 50 Q 4 36 14 22 Q 26 8 42 20 L 50 28 L 58 20 Q 74 8 86 22 Q 96 36 84 50 Z"],
  };
  const lens = [260, 240, 130, 90];
  return (
    <svg width={104} height={104} viewBox="0 0 100 100">
      {paths[kind].map((d, i) => (
        <path key={i} d={d} fill="none" stroke={[C.blue, C.orange, C.red][i % 3]} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray={lens[i] + 40} strokeDashoffset={(lens[i] + 40) * (1 - [p1, p2, p3][i])} />
      ))}
    </svg>
  );
};
export const CTA: React.FC = () => {
  const f = useF();
  return (
    <AbsoluteFill style={{ padding: "110px 130px", justifyContent: "center", alignItems: "center" }}>
      <div style={{ display: "flex", gap: 90, marginBottom: 70 }}>
        {[
          { k: "like", t: "点赞", at: 33 },
          { k: "coin", t: "投币", at: 63 },
          { k: "fav", t: "收藏", at: 93 },
        ].map((x) => (
          <div key={x.k} style={{ textAlign: "center" }}>
            <Icon3 at={x.at} kind={x.k} />
            <div style={{ fontSize: 30, fontWeight: 700, fontFamily: KAI, marginTop: 10, opacity: anim(f, x.at + 24, 10) }}>{x.t}</div>
          </div>
        ))}
      </div>
      <div style={{ position: "relative", opacity: anim(f, 273, 16) }}>
        <div style={{ border: `3px solid ${C.blue}`, borderRadius: 999, padding: "24px 60px", fontSize: 46, fontWeight: 700, fontFamily: HEI, background: "rgba(91,141,184,0.07)" }}>
          ⌕ GitHub 搜索：EduEvidence
        </div>
      </div>
      <div style={{ marginTop: 60, position: "relative" }}>
        <div style={{ fontSize: 80, fontWeight: 900, fontFamily: KAI, opacity: anim(f, 393, 20) }}>
          让 AI 先拿出<span style={{ color: C.red }}>证据</span>
        </div>
        <HandUnderline at={415} w={760} color={C.red} style={{ left: 20, top: 96 }} />
      </div>
    </AbsoluteFill>
  );
};

/* ========== End · 10s ========== */
export const End: React.FC = () => {
  const f = useF();
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 140, fontWeight: 900, fontFamily: KAI, opacity: anim(f, 21, 16) }}>
          Edu<span style={{ color: C.red }}>Evidence</span>
        </div>
        <div style={{ fontSize: 36, color: C.dim, letterSpacing: 8, marginTop: 20, opacity: anim(f, 40, 14) }}>
          EVIDENCE-BASED EDUCATION DECISIONS
        </div>
        <div style={{ fontSize: 32, color: C.dim, fontFamily: MONO, marginTop: 26, opacity: anim(f, 56, 14) }}>
          github.com/37chengshan/eduevidence
        </div>
        {/* 猫坐下喵 */}
        <div style={{ position: "relative", display: "inline-block", marginTop: 30 }}>
          <div style={{ fontSize: 60, opacity: anim(f, 180, 10), transform: "rotate(-8deg)", fontFamily: KAI }}>喵 ~</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
