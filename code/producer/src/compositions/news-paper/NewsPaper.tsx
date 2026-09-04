// NewsPaperTemplate — 对标《AI早报/晚报》聚合页版式（doc/09 §新闻方向对标，2026-09-04 逆向）
//
// 整体框架（保持对标不变）：
//   顶部板块 tab（联动高亮） + 大标题 + 内容模板 T1-T6 + 频道贴纸 + 底部词条 tab + 常驻字幕条
//   插入素材三档 S1 全屏 / S2 大幅 / S3 居中卡（一条新闻中间插截图/录屏）
//   卡片聚光：同屏多卡时，正在解说的卡亮边框（V2 实测机制）
//
// 我方特色（在框架上的创新，均为确定性动画，无随机）：
//   1) 来源可信条 TrustLine：每卡底部 source + 已核验点（facts/sourceSnapshotHash 纪律上屏）
//   2) 自动模板路由：不配 template 时按要点数自动选 T6/T3/T4/2×3，内容侧零标记成本
//   3) 场次自动换肤：style="news-paper" 时 morning=浅皮 / evening=深皮（tokens.ts）
//   4) 底部词条 tab = 进度条：当前词条随 block 内进度填充（字级时间戳血统）
//   5) 数字弹跳 number-pop：stats/highlight 值 spring 弹出，全片硬上限 3 次（keyword-pop 红线同源）
//   6) 图表真渲染：chart 块代码画条形图（对标是贴原图，我们原生渲染可动画）
//
// 确定性：全部 useCurrentFrame + spring/interpolate，可 seek、可复现。

import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  Series,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Video,
} from "remotion";
import type { VideoBlock, VideoConfig } from "../../data/types";
import type { TimelineEntries } from "../VidoShort";
import { useStyle } from "../styles/StyleProvider";
import {
  ICON_COLOR_CYCLE,
  paperColor,
  resolvePaperTokens,
  type IconColorName,
  type PaperTokens,
} from "./tokens";

// ============================== 图标（内联 SVG，禁 emoji） ==============================

const GLYPHS: Record<string, string> = {
  zap: "M13 2 3 14h7l-1 8 10-12h-7l1-8z",
  rocket: "M4.5 16.5 3 21l4.5-1.5M15 9a1.5 1.5 0 1 0 .01 0M9 15l-3 3m2-10c3.5-4 8-5 12-4 1 4-1 8.5-5 12l-4-1-3-3-1-4z",
  box: "M21 8 12 3 3 8v8l9 5 9-5V8zm-9-2.7L18.6 8 12 11.7 5.4 8 12 5.3zM5 9.7l6 3.4v6.2l-6-3.4V9.7zm14 6.2-6 3.4v-6.2l6-3.4v6.2z",
  chart: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm-9-9h18M12 3c2.5 2.4 4 5.6 4 9s-1.5 6.6-4 9c-2.5-2.4-4-5.6-4-9s1.5-6.6 4-9z",
  sparkles: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zm7 10l.9 2.1L22 16l-2.1.9L19 19l-.9-2.1L16 16l2.1-.9L19 13zM5 15l.7 1.8L7.5 17.5l-1.8.7L5 20l-.7-1.8L2.5 17.5l1.8-.7L5 15z",
  shield: "M12 3l8 3v6c0 4.5-3.2 7.7-8 9-4.8-1.3-8-4.5-8-9V6l8-3zm-2 9l2 2 4-4",
  calendar: "M7 3v3m10-3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
};
const GLYPH_CYCLE = ["zap", "rocket", "box", "chart", "globe", "sparkles"] as const;

const IconGlyph: React.FC<{
  name: string;
  color: string;
  size?: number;
}> = ({ name, color, size = 22 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={GLYPHS[name] ?? GLYPHS.sparkles} />
  </svg>
);

// ============================== 文案工具 ==============================

const clip = (s: string, n: number): string =>
  s.length > n ? s.slice(0, Math.max(0, n - 1)) + "…" : s;

/** "标题：正文" → {title, body}；无分隔则 title 留空 */
const splitPoint = (raw: string): { title: string; body: string } => {
  const i = raw.indexOf("：") >= 0 ? raw.indexOf("：") : raw.indexOf(": ");
  if (i > 0 && i <= 14 && raw.length - i > 2) {
    return { title: raw.slice(0, i).trim(), body: raw.slice(i + 1).trim() };
  }
  return { title: "", body: raw.trim() };
};

/** 卡内关键词（highlight + stats label + source），用于行内 chip 与底部词条 */
const keywordsOf = (b: VideoBlock): string[] => {
  const set: string[] = [];
  const push = (s?: string) => {
    if (!s) return;
    const t = s.trim();
    if (t.length >= 2 && t.length <= 12 && !set.includes(t)) set.push(t);
  };
  push(b.highlight);
  (b.stats ?? []).forEach((s) => push(s.label));
  push(b.source);
  return set;
};

/** 行内 chip 渲染：正文中出现的关键词包一层浅底 chip（每卡上限 3 个，防噪） */
const BodyWithChips: React.FC<{
  text: string;
  words: string[];
  tokens: PaperTokens;
  fontSize: number;
}> = ({ text, words, tokens, fontSize }) => {
  const hits = words.filter((w) => text.includes(w)).slice(0, 3);
  if (hits.length === 0) return <span>{text}</span>;
  const pattern = new RegExp(
    "(" + hits.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")"
  );
  const parts = text.split(pattern);
  return (
    <span>
      {parts.map((p, i) =>
        hits.includes(p) ? (
          <span
            key={i}
            style={{
              background: tokens.dark ? "#FFFFFF22" : "#1F1F1F0D",
              border: `1px solid ${tokens.dark ? "#FFFFFF1F" : "#1F1F1F14"}`,
              borderRadius: 6,
              padding: "0 8px",
              margin: "0 2px",
              fontWeight: 700,
              color: tokens.text,
              whiteSpace: "nowrap",
            }}
          >
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </span>
  );
};

// ============================== 结构推导 ==============================

interface PaperSection {
  key: string;
  label: string;
  keywords: string[];
  indices: number[];
}

const SECTION_LABELS: Record<string, string> = {
  "review-ai": "要闻",
  "review-other": "要闻",
  "ai-news": "要闻",
  "intl-news": "环球",
  "cn-news": "国内",
  "ent-news": "文娱",
  "other-news": "行业动态",
  problem: "深度",
  features: "深度",
  architecture: "深度",
  "hands-on": "实操",
  outro: "Outro",
};

const sectionKeyOf = (b: VideoBlock): string => {
  const raw = b.section ?? b.tag ?? "";
  if (raw === "outro") return "outro";
  if (b.type === "title" && !raw) return "intro";
  return raw || (b.type === "title" ? "intro" : "news");
};

const buildSections = (blocks: VideoBlock[]): PaperSection[] => {
  const order: string[] = [];
  const map = new Map<string, PaperSection>();
  blocks.forEach((b, i) => {
    const key = sectionKeyOf(b);
    if (!map.has(key)) {
      order.push(key);
      map.set(key, { key, label: SECTION_LABELS[key] ?? "资讯", keywords: [], indices: [] });
    }
    const sec = map.get(key)!;
    sec.indices.push(i);
    const kw =
      b.highlight ?? (b.stats && b.stats[0] ? b.stats[0].label : undefined) ?? b.source;
    if (kw && sec.keywords.length < 12) sec.keywords.push(clip(kw.trim(), 8));
  });
  return order.map((k) => map.get(k)!);
};

const framesForBlock = (
  config: VideoConfig,
  timelineEntries: TimelineEntries | undefined,
  i: number
): number => {
  if (timelineEntries && timelineEntries[i]) return Math.max(30, timelineEntries[i].targetFrames);
  return config.blocks[i]?.type === "title" ? 75 : 90;
};

/** 全片 number-pop 白名单：按块序取前 3 个含 stats/highlight 的块（确定性，硬上限） */
const popWhitelist = (blocks: VideoBlock[]): Set<number> => {
  const set = new Set<number>();
  for (let i = 0; i < blocks.length && set.size < 3; i++) {
    if ((blocks[i].stats && blocks[i].stats!.length > 0) || blocks[i].highlight) set.add(i);
  }
  return set;
};

// ============================== 常驻件 ==============================

const TopTabs: React.FC<{
  sections: PaperSection[];
  activeKey: string;
  tokens: PaperTokens;
  fontSize: number;
}> = ({ sections, activeKey, tokens, fontSize }) => (
  <div
    style={{
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: fontSize * 2.4,
      display: "flex",
      alignItems: "stretch",
      gap: 4,
      padding: "10px 24px 0",
      zIndex: 30,
    }}
  >
    {sections.map((s) => {
      const active = s.key === activeKey;
      const pop = spring({
        frame: active ? 6 : 0,
        fps: 30,
        config: { damping: 24, stiffness: 220 },
      });
      return (
        <div
          key={s.key}
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            padding: `0 ${fontSize}px`,
            borderRadius: 10,
            color: active ? tokens.tabActiveFg : tokens.textMuted,
            fontSize,
            fontWeight: active ? 700 : 500,
            background: active ? tokens.tabActiveBg : "transparent",
            opacity: active ? 0.4 + 0.6 * pop : 1,
          }}
        >
          {s.label}
        </div>
      );
    })}
  </div>
);

const BottomKeywordTabs: React.FC<{
  keywords: string[];
  activeIndex: number;
  progress: number;
  tokens: PaperTokens;
  fontSize: number;
}> = ({ keywords, activeIndex, progress, tokens, fontSize }) => (
  <div
    style={{
      position: "absolute",
      bottom: fontSize * 3.4,
      left: 0,
      right: 0,
      display: "flex",
      justifyContent: "center",
      gap: fontSize * 0.9,
      padding: `0 40px`,
      zIndex: 30,
      flexWrap: "nowrap",
      overflow: "hidden",
    }}
  >
    {keywords.map((k, i) => {
      const active = i === activeIndex;
      return (
        <div
          key={i}
          style={{
            position: "relative",
            padding: `${fontSize * 0.28}px ${fontSize * 0.62}px`,
            borderRadius: 999,
            fontSize,
            whiteSpace: "nowrap",
            color: active ? tokens.tabActiveFg : tokens.textMuted,
            fontWeight: active ? 700 : 500,
            background: active ? tokens.tabActiveBg : "transparent",
            overflow: "hidden",
          }}
        >
          {active ? (
            <span
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: `${Math.min(100, Math.max(0, progress * 100))}%`,
                background: "#00000022",
              }}
            />
          ) : null}
          <span style={{ position: "relative" }}>{k}</span>
        </div>
      );
    })}
  </div>
);

const StickerChip: React.FC<{ text: string; tokens: PaperTokens; fontSize: number }> = ({
  text,
  tokens,
  fontSize,
}) => {
  if (!text) return null;
  return (
    <div
      style={{
        position: "absolute",
        bottom: fontSize * 1.4,
        left: "50%",
        transform: "translateX(-50%)",
        background: tokens.stickerBg,
        color: tokens.stickerFg,
        borderRadius: 8,
        padding: `${fontSize * 0.3}px ${fontSize * 0.8}px`,
        fontSize,
        fontWeight: 600,
        zIndex: 30,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </div>
  );
};

const SubtitleBar: React.FC<{
  text: string;
  seqFrame: number;
  tokens: PaperTokens;
  fps: number;
  fontSize: number;
}> = ({ text, seqFrame, tokens, fps, fontSize }) => {
  if (!text) return null;
  const pop = spring({ frame: seqFrame, fps, config: { damping: 200, stiffness: 260 } });
  const outline = tokens.subtitleStyle === "outline";
  return (
    <div
      style={{
        position: "absolute",
        bottom: fontSize * 1.1,
        left: "50%",
        transform: `translateX(-50%) translateY(${(1 - pop) * 8}px)`,
        opacity: pop,
        background: outline ? "transparent" : "#282828D9",
        borderRadius: outline ? 0 : 999,
        padding: outline ? 0 : `${fontSize * 0.26}px ${fontSize * 0.7}px`,
        color: "#FFFFFF",
        fontSize,
        fontWeight: 600,
        zIndex: 40,
        textShadow: outline
          ? "-2px 0 0 #000, 2px 0 0 #000, 0 -2px 0 #000, 0 2px 0 #000, -2px -2px 0 #000, 2px 2px 0 #000, -2px 2px 0 #000, 2px -2px 0 #000"
          : "none",
        maxWidth: "76%",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textAlign: "center",
      }}
    >
      {text}
    </div>
  );
};

/** 来源可信条（我方特色）：source + 已核验点；无来源时降级为占位灰点 */
const TrustLine: React.FC<{
  source?: string;
  url?: string;
  tokens: PaperTokens;
  fontSize: number;
}> = ({ source, url, tokens, fontSize }) => {
  const host = (() => {
    if (!url) return "";
    try {
      return new URL(url).host.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  const label = source ?? host;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginTop: 12,
        fontSize,
        color: tokens.textMuted,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: label ? tokens.green : tokens.border,
          display: "inline-block",
        }}
      />
      <span>{label ? `${label} · 已核验快照` : "待核验"}</span>
    </div>
  );
};

// ============================== 内容屏 ==============================

const ScreenTitle: React.FC<{
  text: string;
  tokens: PaperTokens;
  fontSize: number;
}> = ({ text, tokens, fontSize }) => (
  <div style={{ textAlign: "center", marginBottom: 28 }}>
    <div style={{ fontSize, fontWeight: 800, color: tokens.title, lineHeight: 1.25 }}>
      {text}
    </div>
    <div
      style={{
        width: 96,
        height: 5,
        borderRadius: 3,
        margin: "14px auto 0",
        background: `linear-gradient(90deg, transparent, ${tokens.red}, transparent)`,
      }}
    />
  </div>
);

const PaperCard: React.FC<{
  point: string;
  glyph: string;
  colorName: IconColorName;
  words: string[];
  spotlight: boolean;
  enterFrame: number;
  tokens: PaperTokens;
  fps: number;
  bodySize: number;
}> = ({ point, glyph, colorName, words, spotlight, enterFrame, tokens, fps, bodySize }) => {
  const { title, body } = splitPoint(point);
  const color = paperColor(tokens, colorName);
  const enter = spring({ frame: enterFrame, fps, config: { damping: 22, stiffness: 200 } });
  const spot = spring({ frame: spotlight ? 4 : 0, fps, config: { damping: 20, stiffness: 260 } });
  return (
    <div
      style={{
        background: tokens.surface,
        border: `1px solid ${tokens.border}`,
        outline: spotlight ? `2px solid ${color}` : "2px solid transparent",
        outlineOffset: -1,
        borderRadius: 16,
        padding: "20px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        opacity: enter,
        transform: `scale(${(0.95 + 0.05 * enter) * (1 + 0.02 * spot)})`,
        boxShadow: tokens.dark
          ? "0 2px 10px rgba(0,0,0,0.35)"
          : "0 2px 8px rgba(0,0,0,0.04)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: `${color}22`,
          }}
        >
          <IconGlyph name={glyph} color={color} size={20} />
        </span>
        {title ? (
          <span style={{ fontSize: bodySize * 1.12, fontWeight: 800, color }}>
            {title}
          </span>
        ) : null}
      </div>
      <div style={{ fontSize: bodySize, color: tokens.text, lineHeight: 1.55 }}>
        <BodyWithChips text={body} words={words} tokens={tokens} fontSize={bodySize} />
      </div>
      <TrustLine tokens={tokens} fontSize={bodySize * 0.72} />
    </div>
  );
};

/** 数字弹跳（number-pop ≤3/片）：值 spring 弹出，确定性 */
const PopValue: React.FC<{
  value: string;
  show: boolean;
  seqFrame: number;
  tokens: PaperTokens;
  fps: number;
  fontSize: number;
}> = ({ value, show, seqFrame, tokens, fps, fontSize }) => {
  if (!show || !value) return null;
  const pop = spring({ frame: seqFrame + 12, fps, config: { damping: 12, stiffness: 180 } });
  const scale = 0.4 + 0.6 * pop + (pop >= 1 ? 0 : 0.15 * Math.sin(pop * Math.PI));
  return (
    <span
      style={{
        display: "inline-block",
        transform: `scale(${scale})`,
        color: tokens.red,
        fontWeight: 800,
        fontSize,
      }}
    >
      {value}
    </span>
  );
};

/** 自动模板路由（我方特色）：按要点数选网格 —— 3→1×3, 4→2×2, 5→3+2, ≥6→2×3 */
const gridLayout = (n: number): "1x3" | "2x2" | "3+2" | "2x3" =>
  n <= 3 ? "1x3" : n === 4 ? "2x2" : n === 5 ? "3+2" : "2x3";

const GridScreen: React.FC<{
  block: VideoBlock;
  seqFrame: number;
  seqFrames: number;
  popEnabled: boolean;
  tokens: PaperTokens;
  fps: number;
  long: boolean;
}> = ({ block, seqFrame, seqFrames, popEnabled, tokens, fps, long }) => {
  const points = (block.points && block.points.length > 0 ? block.points : block.items ?? []).slice(0, 6);
  const layout = gridLayout(points.length);
  const titleSize = long ? 52 : 44;
  const bodySize = long ? 24 : 22;
  const progress = seqFrames > 0 ? seqFrame / seqFrames : 0;
  const activeIdx = Math.min(points.length - 1, Math.floor(progress * points.length));
  // block.icon 覆盖：整块统一 icon 语义（缺省按卡内序号四色轮换）
  const glyphOv = block.icon?.glyph;
  const colorOv = block.icon?.color;
  const kws = keywordsOf(block);
  const rows = useMemo(() => {
    if (layout === "1x3") return [points.slice(0, 3)];
    if (layout === "2x2") return [points.slice(0, 2), points.slice(2, 4)];
    if (layout === "3+2") return [points.slice(0, 3), points.slice(3, 5)];
    return [points.slice(0, 3), points.slice(3, 6)];
  }, [layout, points]);
  return (
    <AbsoluteFill style={{ justifyContent: "center", padding: long ? "96px 96px 140px" : "70px 60px 190px" }}>
      {block.content ? (
        <ScreenTitle text={block.content} tokens={tokens} fontSize={titleSize} />
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 20, flex: 1, justifyContent: "center" }}>
        {rows.map((row, r) => (
          <div key={r} style={{ display: "flex", gap: 20, justifyContent: "center" }}>
            {row.map((p, i) => {
              const globalIdx = r * 3 + i;
              return (
                <div key={globalIdx} style={{ flex: 1, maxWidth: layout === "1x3" ? 480 : undefined, position: "relative" }}>
                  <PaperCard
                    point={p}
                    glyph={glyphOv ?? GLYPH_CYCLE[globalIdx % GLYPH_CYCLE.length]}
                    colorName={colorOv ?? ICON_COLOR_CYCLE[globalIdx % ICON_COLOR_CYCLE.length]}
                    words={kws}
                    spotlight={globalIdx === activeIdx}
                    enterFrame={seqFrame - (globalIdx * 4 + 2)}
                    tokens={tokens}
                    fps={fps}
                    bodySize={bodySize}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {popEnabled && block.stats && block.stats[0] ? (
        <div style={{ textAlign: "center", marginTop: 10, fontSize: bodySize * 1.2, color: tokens.text }}>
          {block.stats[0].label}
          {" "}
          <PopValue
            value={block.stats[0].value}
            show
            seqFrame={seqFrame}
            tokens={tokens}
            fps={fps}
            fontSize={bodySize * 1.5}
          />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/** T5 文章特写（双语/摘要/事实） */
const ArticleFeature: React.FC<{
  block: VideoBlock;
  seqFrame: number;
  tokens: PaperTokens;
  fps: number;
  long: boolean;
}> = ({ block, seqFrame, tokens, fps, long }) => {
  const enter = spring({ frame: seqFrame, fps, config: { damping: 24, stiffness: 180 } });
  const bodySize = long ? 26 : 24;
  return (
    <AbsoluteFill style={{ justifyContent: "center", padding: long ? "110px 150px 150px" : "80px 70px 200px" }}>
      <div
        style={{
          background: tokens.surface,
          border: `1px solid ${tokens.border}`,
          borderRadius: 20,
          padding: long ? "40px 48px" : "30px 30px",
          opacity: enter,
          transform: `translateY(${(1 - enter) * 18}px)`,
          boxShadow: tokens.dark ? "0 4px 18px rgba(0,0,0,0.4)" : "0 4px 16px rgba(0,0,0,0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <span
            style={{
              fontSize: bodySize * 0.72,
              color: tokens.textMuted,
              border: `1px solid ${tokens.border}`,
              borderRadius: 6,
              padding: "2px 10px",
            }}
          >
            {block.source ?? "官方原文"}
          </span>
          {block.url ? (
            <span
              style={{
                fontSize: bodySize * 0.72,
                color: tokens.blue,
                borderBottom: `2px dashed ${tokens.blue}`,
              }}
            >
              {(() => {
                try {
                  return new URL(block.url).host.replace(/^www\./, "");
                } catch {
                  return block.url;
                }
              })()}
            </span>
          ) : null}
        </div>
        <div style={{ fontSize: bodySize * 1.5, fontWeight: 800, color: tokens.title, marginBottom: 18 }}>
          {block.content}
        </div>
        {block.summary ? (
          <div style={{ fontSize: bodySize, color: tokens.text, lineHeight: 1.7, marginBottom: 16 }}>
            {block.summary}
          </div>
        ) : null}
        {(block.facts ?? []).slice(0, 4).map((f, i) => (
          <div key={i} style={{ display: "flex", gap: 10, fontSize: bodySize * 0.92, color: tokens.text, lineHeight: 1.6, marginBottom: 8 }}>
            <span style={{ color: paperColor(tokens, ICON_COLOR_CYCLE[i % 4]), fontWeight: 800 }}>●</span>
            <span>{f}</span>
          </div>
        ))}
        <TrustLine source={block.source} url={block.url} tokens={tokens} fontSize={bodySize * 0.72} />
        {block.disclaimer ? (
          <div style={{ marginTop: 8, fontSize: bodySize * 0.68, color: tokens.textMuted }}>
            {block.disclaimer}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

/** 插入素材屏 S1 全屏 / S2 大幅 / S3 居中卡（一条新闻中间插截图/录屏） */
const EvidenceScreen: React.FC<{
  block: VideoBlock;
  seqFrame: number;
  tokens: PaperTokens;
  fps: number;
  long: boolean;
}> = ({ block, seqFrame, tokens, fps, long }) => {
  const scale = block.evidence?.scale ?? (block.type === "video" ? "full" : "card");
  const enter = spring({ frame: seqFrame, fps, config: { damping: 22, stiffness: 190 } });
  const src = block.src ?? block.media?.src ?? "";
  const caption = block.evidence?.caption ?? block.media?.caption ?? block.content;
  const ghostTitle = block.content ?? "";

  if (scale === "full") {
    return (
      <AbsoluteFill style={{ background: "#000", opacity: enter }}>
        {block.type === "video" && src ? (
          <Video src={src} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        ) : src ? (
          <img src={src} alt={caption} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        ) : (
          <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
            <div style={{ color: "#fff", fontSize: long ? 40 : 34 }}>{caption}</div>
          </AbsoluteFill>
        )}
      </AbsoluteFill>
    );
  }

  if (scale === "wide") {
    return (
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            position: "absolute",
            top: long ? 96 : 80,
            left: 0,
            right: 0,
            textAlign: "center",
            fontSize: long ? 64 : 52,
            fontWeight: 800,
            color: tokens.title,
            opacity: 0.16,
          }}
        >
          {ghostTitle}
        </div>
        {block.type === "video" && src ? (
          <Video
            src={src}
            style={{
              width: "92%",
              borderRadius: 12,
              boxShadow: "0 18px 50px rgba(0,0,0,0.25)",
              transform: `translateY(${(1 - enter) * 16}px)`,
            }}
          />
        ) : (
          <img
            src={src}
            alt={caption}
            style={{
              maxWidth: "92%",
              maxHeight: "78%",
              objectFit: "contain",
              borderRadius: 12,
              boxShadow: "0 18px 50px rgba(0,0,0,0.25)",
              opacity: enter,
              transform: `translateY(${(1 - enter) * 16}px)`,
            }}
          />
        )}
        <div style={{ position: "absolute", bottom: long ? 130 : 200, fontSize: long ? 22 : 20, color: tokens.textMuted }}>
          {clip(caption, 40)}
        </div>
      </AbsoluteFill>
    );
  }

  // card（S3 居中证据卡）
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div
        style={{
          width: long ? "62%" : "74%",
          background: tokens.surface,
          border: `1px solid ${tokens.border}`,
          borderRadius: 16,
          padding: 16,
          opacity: enter,
          transform: `translateY(${(1 - enter) * 20}px) scale(${0.97 + 0.03 * enter})`,
          boxShadow: tokens.dark ? "0 10px 36px rgba(0,0,0,0.45)" : "0 10px 36px rgba(0,0,0,0.12)",
        }}
      >
        {block.type === "video" && src ? (
          <Video src={src} style={{ width: "100%", borderRadius: 10 }} />
        ) : (
          <img
            src={src}
            alt={caption}
            style={{ width: "100%", maxHeight: long ? 520 : 560, objectFit: "contain", borderRadius: 10 }}
          />
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 6px 2px" }}>
          <span style={{ fontSize: long ? 22 : 20, color: tokens.text, fontWeight: 600 }}>{clip(caption, 36)}</span>
          <span style={{ fontSize: long ? 17 : 16, color: tokens.textMuted }}>
            {block.media?.credit ?? block.source ?? ""}
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** chart 块真渲染（我方特色：对标贴原图，我们原生渲染 + 生长动画） */
const PaperChart: React.FC<{
  block: VideoBlock;
  seqFrame: number;
  tokens: PaperTokens;
  fps: number;
  long: boolean;
}> = ({ block, seqFrame, tokens, fps, long }) => {
  const data = block.data ?? [];
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.value), 1);
  const bodySize = long ? 24 : 22;
  const enter = spring({ frame: seqFrame, fps, config: { damping: 24, stiffness: 180 } });
  return (
    <AbsoluteFill style={{ justifyContent: "center", padding: long ? "110px 150px 150px" : "80px 70px 200px" }}>
      <div
        style={{
          background: tokens.surface,
          border: `1px solid ${tokens.border}`,
          borderRadius: 20,
          padding: long ? "40px 48px" : "30px 30px",
          opacity: enter,
        }}
      >
        <div style={{ fontSize: bodySize * 1.5, fontWeight: 800, color: tokens.title, marginBottom: 24 }}>
          {block.content}
        </div>
        {data.map((d, i) => {
          const grow = spring({
            frame: seqFrame - 8 - i * 3,
            fps,
            config: { damping: 20, stiffness: 140 },
          });
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", height: bodySize * 2.4 }}>
              <div style={{ width: 240, fontSize: bodySize * 0.88, color: tokens.textMuted, textAlign: "right", paddingRight: 20, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {d.label}
              </div>
              <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
                <div
                  style={{
                    width: `${(d.value / max) * 100 * grow}%`,
                    height: bodySize * 0.9,
                    background: paperColor(tokens, ICON_COLOR_CYCLE[i % 4]),
                    borderRadius: 8,
                    minWidth: 8,
                  }}
                />
              </div>
              <div style={{ marginLeft: 16, fontSize: bodySize * 0.95, fontWeight: 700, color: tokens.text, minWidth: 80 }}>
                {d.value.toLocaleString("en-US")}
              </div>
            </div>
          );
        })}
        <TrustLine source={block.source} url={block.url} tokens={tokens} fontSize={bodySize * 0.72} />
      </div>
    </AbsoluteFill>
  );
};

/** title 块 = 板块转场大标题屏（对标 f_012 cross-fade 时刻） */
const TitleScreen: React.FC<{
  block: VideoBlock;
  config: VideoConfig;
  seqFrame: number;
  tokens: PaperTokens;
  fps: number;
  long: boolean;
}> = ({ block, config, seqFrame, tokens, fps, long }) => {
  const pop = spring({ frame: seqFrame, fps, config: { damping: 26, stiffness: 160 } });
  const size = long ? 88 : 64;
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 60 }}>
      <div style={{ textAlign: "center", opacity: pop, transform: `scale(${0.96 + 0.04 * pop})` }}>
        <div style={{ fontSize: long ? 30 : 26, color: tokens.textMuted, marginBottom: 18, letterSpacing: 4 }}>
          {config.title}
        </div>
        <div style={{ fontSize: size, fontWeight: 800, color: tokens.title, lineHeight: 1.3 }}>
          {block.content}
        </div>
        <div
          style={{
            width: 140,
            height: 6,
            borderRadius: 3,
            margin: "26px auto 0",
            background: `linear-gradient(90deg, transparent, ${tokens.red}, transparent)`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

/** 兜底陈述屏 */
const StatementScreen: React.FC<{
  block: VideoBlock;
  seqFrame: number;
  tokens: PaperTokens;
  fps: number;
  long: boolean;
}> = ({ block, seqFrame, tokens, fps, long }) => {
  const enter = spring({ frame: seqFrame, fps, config: { damping: 24, stiffness: 180 } });
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: long ? "0 180px 120px" : "0 80px 200px" }}>
      <div style={{ textAlign: "center", opacity: enter, transform: `translateY(${(1 - enter) * 14}px)` }}>
        <div style={{ fontSize: long ? 56 : 46, fontWeight: 800, color: tokens.text, lineHeight: 1.4 }}>
          <BodyWithChips
            text={block.content}
            words={keywordsOf(block)}
            tokens={tokens}
            fontSize={long ? 56 : 46}
          />
        </div>
        <div style={{ marginTop: 28, display: "flex", justifyContent: "center" }}>
          <TrustLine source={block.source} url={block.url} tokens={tokens} fontSize={22} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ============================== 主模板 ==============================

/**
 * news-paper 模板：常驻 chrome（顶部板块 tab / 底部词条 tab / 贴纸 / 字幕条）
 * + Series 逐块渲染（T1-T6 自动路由 + 插入素材三档）+ 每段旁白 Audio。
 * S1 全屏插入时 chrome 自动淡出、段尾淡回（对标行为）。
 */
export const NewsPaperTemplate: React.FC<{
  config: VideoConfig;
  timelineEntries?: TimelineEntries;
  fps: number;
  voiceoverRoot?: string;
}> = ({ config, timelineEntries, fps, voiceoverRoot }) => {
  const frame = useCurrentFrame();
  const { fps: videoFps } = useVideoConfig();
  const { orientation } = useStyle();
  const long = orientation === "long";
  const tokens = resolvePaperTokens(config.style, config.edition);

  const sections = useMemo(() => buildSections(config.blocks), [config.blocks]);
  const pops = useMemo(() => popWhitelist(config.blocks), [config.blocks]);

  const frames = useMemo(
    () => config.blocks.map((_, i) => framesForBlock(config, timelineEntries, i)),
    [config, timelineEntries]
  );
  const starts = useMemo(() => {
    const acc: number[] = [];
    let s = 0;
    frames.forEach((f) => {
      acc.push(s);
      s += f;
    });
    return acc;
  }, [frames]);

  let currentIdx = 0;
  for (let i = 0; i < starts.length; i++) {
    if (frame >= starts[i]) currentIdx = i;
  }
  const block = config.blocks[currentIdx];
  const seqFrame = frame - starts[currentIdx];
  const seqFrames = frames[currentIdx];

  // 空 blocks 守卫（Studio 空数据预览不崩）
  if (!block) {
    return <AbsoluteFill style={{ fontFamily: tokens.fontFamily }} />;
  }

  const activeSection =
    sections.find((s) => s.indices.includes(currentIdx)) ?? sections[0];
  const keywords = activeSection ? activeSection.keywords : [];
  const kwOfBlock = (() => {
    const b = block;
    const kw =
      b.highlight ?? (b.stats && b.stats[0] ? b.stats[0].label : undefined) ?? b.source;
    if (!kw) return Math.min(1, keywords.length - 1);
    const idx = keywords.indexOf(clip(kw.trim(), 8));
    return idx >= 0 ? idx : Math.min(1, keywords.length - 1);
  })();
  const blockProgress = seqFrames > 0 ? Math.min(1, seqFrame / seqFrames) : 0;

  // 贴纸：从 runId 提取日期 → "今天是M月D日 周X"；否则用 footer/subtitle
  const sticker = (() => {
    const m = /(\d{4})-(\d{2})-(\d{2})/.exec(config.runId ?? "");
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      const wd = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
      return `今天是${Number(m[2])}月${Number(m[3])}日 周${wd}`;
    }
    return config.footer ?? "";
  })();

  const subtitleText =
    block.subtitle ?? (block.narration ? clip(block.narration.replace(/\s+/g, ""), 28) : "");

  // S1 全屏插入 → chrome 淡出（段头 6 帧 / 段尾 6 帧）
  const fullBleed =
    (block.evidence?.scale ?? (block.type === "video" ? "full" : undefined)) === "full";
  const chromeOpacity = fullBleed
    ? interpolate(seqFrame, [0, 6, seqFrames - 6, seqFrames], [1, 0, 0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;

  const tabFont = long ? 22 : 20;
  const kwFont = long ? 20 : 18;

  return (
    <AbsoluteFill style={{ fontFamily: tokens.fontFamily }}>
      <div style={{ position: "absolute", inset: 0, opacity: chromeOpacity }}>
        {/* 内容层（Series 逐块） */}
        <Series>
          {config.blocks.map((b, i) => {
            const audio =
              timelineEntries && timelineEntries[i] && timelineEntries[i].audioPath
                ? staticFile(voiceoverRoot ? voiceoverRoot + "/" + i + ".wav" : `voiceover/${i}.wav`)
                : null;
            return (
              <Series.Sequence key={i} durationInFrames={frames[i]}>
                <SequenceBlock
                  block={b}
                  config={config}
                  seqFrames={frames[i]}
                  popEnabled={pops.has(i)}
                  tokens={tokens}
                  fps={videoFps}
                  long={long}
                />
                {audio ? <Audio src={audio} /> : null}
              </Series.Sequence>
            );
          })}
        </Series>

        {/* chrome 层 */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <TopTabs
            sections={sections}
            activeKey={activeSection ? activeSection.key : "news"}
            tokens={tokens}
            fontSize={tabFont}
          />
          <BottomKeywordTabs
            keywords={keywords}
            activeIndex={kwOfBlock}
            progress={blockProgress}
            tokens={tokens}
            fontSize={kwFont}
          />
          <StickerChip text={sticker} tokens={tokens} fontSize={kwFont} />
          <SubtitleBar
            text={subtitleText}
            seqFrame={seqFrame}
            tokens={tokens}
            fps={videoFps}
            fontSize={long ? 30 : 28}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ============================== 块级渲染路由（自动模板选择） ==============================

const renderBlock = (
  b: VideoBlock,
  config: VideoConfig,
  ctx: {
    seqFrame: number;
    seqFrames: number;
    popEnabled: boolean;
    tokens: PaperTokens;
    fps: number;
    long: boolean;
  }
): React.ReactNode => {
  const override = b.template;
  const pointsCount = (b.points && b.points.length > 0 ? b.points : b.items ?? []).length;

  if (b.type === "title") {
    return <TitleScreen block={b} config={config} seqFrame={ctx.seqFrame} tokens={ctx.tokens} fps={ctx.fps} long={ctx.long} />;
  }
  if (b.type === "image" || b.type === "video" || override === "T2") {
    return <EvidenceScreen block={b} seqFrame={ctx.seqFrame} tokens={ctx.tokens} fps={ctx.fps} long={ctx.long} />;
  }
  if (b.type === "chart") {
    return <PaperChart block={b} seqFrame={ctx.seqFrame} tokens={ctx.tokens} fps={ctx.fps} long={ctx.long} />;
  }
  if (override === "T5" || (b.type === "text" && pointsCount === 0 && (b.summary || (b.facts && b.facts.length > 0)))) {
    return <ArticleFeature block={b} seqFrame={ctx.seqFrame} tokens={ctx.tokens} fps={ctx.fps} long={ctx.long} />;
  }
  if (pointsCount >= 3 || override === "T3" || override === "T4" || override === "T6") {
    return (
      <GridScreen
        block={b}
        seqFrame={ctx.seqFrame}
        seqFrames={ctx.seqFrames}
        popEnabled={ctx.popEnabled}
        tokens={ctx.tokens}
        fps={ctx.fps}
        long={ctx.long}
      />
    );
  }
  return <StatementScreen block={b} seqFrame={ctx.seqFrame} tokens={ctx.tokens} fps={ctx.fps} long={ctx.long} />;
};

/** Series.Sequence 内的块宿主：内部取 useCurrentFrame（Sequence 内相对帧），再路由到内容屏 */
const SequenceBlock: React.FC<{
  block: VideoBlock;
  config: VideoConfig;
  seqFrames: number;
  popEnabled: boolean;
  tokens: PaperTokens;
  fps: number;
  long: boolean;
}> = ({ block, config, seqFrames, popEnabled, tokens, fps, long }) => {
  const seqFrame = useCurrentFrame();
  return (
    <>{renderBlock(block, config, { seqFrame, seqFrames, popEnabled, tokens, fps, long })}</>
  );
};

// ============================== 背景装饰（StyleProvider 分发用） ==============================

/** 纸媒底：纯色 + 极淡中性纸纹（确定性，无随机；深浅皮通用）——bg 色由 StyleTheme.background 提供 */
export const NewsPaperBackground: React.FC = () => (
  <AbsoluteFill
    style={{
      backgroundImage:
        "repeating-linear-gradient(0deg, rgba(127,127,127,0.02) 0px, rgba(127,127,127,0.02) 1px, transparent 1px, transparent 3px)",
    }}
  />
);
