/**
 * 打分排序脚本 — 分流打分模型（ai-pulse 模型 + 5 维度模型）
 *
 * 分流规则：
 *  - category "ai"（AI 新闻类）→ ai-pulse 模型：热度信号×0.4 + 时效×0.3 + 来源质量×0.3
 *  - category "other"（其他新闻类）→ 同 ai-pulse 模型（新闻类统一）
 *  - GitHub 开源项目（source=github-trending）→ 额外标注 5 维度评分供项目介绍选题参考
 *
 * ai-pulse 模型（来自 DaiOwen/ai-pulse 生产实践）：
 *  热度信号：多源交叉(+5) / 一线社区高分(+3) / 普通分数(+1)
 *  时效信号：6h内(+5) / 12h内(+3) / 24h内(+1) / 48h内(+0)
 *  来源质量：一线媒体/社区(+3) / 二线(+2) / 其他(+1)
 *
 * 去重：标题相似度 > 80%（字符 bigram Jaccard）合并，保留高分者
 *
 * 用法：npm run score
 * 输入：research/today/raw.json
 * 输出：research/today/top.md（Top 3 推荐卡）+ scored.json + archive 归档
 */
import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const RESEARCH_DIR = path.resolve(process.cwd(), "research", "today");
const ARCHIVE_ROOT = path.resolve(process.cwd(), "research", "archive");

interface RawItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  category?: "ai" | "other";
  score?: number;
  stars?: number;
  summary?: string;
}

interface ScoredItem extends RawItem {
  scores: {
    heat: number; // 热度信号（0-10）
    timeliness: number; // 时效信号（0-10）
    sourceQuality: number; // 来源质量（0-10）
    // 开源项目附加维度（仅 github 源）
    novelty?: number;
    utility?: number;
    videoPotential?: number;
  };
  total: number; // 加权总分 0-10
  duplicated?: string[]; // 被合并的同事件来源
}

// ─────────────────────────── 去重（bigram Jaccard） ───────────────────────────

function bigrams(s: string): Set<string> {
  const t = s.replace(/\s+/g, "").toLowerCase();
  const set = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}

function similarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

function dedupe(items: ScoredItem[]): ScoredItem[] {
  const result: ScoredItem[] = [];
  for (const item of items) {
    const dup = result.find((r) => similarity(r.title, item.title) > 0.8);
    if (dup) {
      dup.duplicated = [...(dup.duplicated ?? []), item.source];
      // 保留分数高者
      if (item.total > dup.total) {
        Object.assign(dup, item, { duplicated: dup.duplicated });
      }
      continue;
    }
    result.push(item);
  }
  return result;
}

// ─────────────────────────── ai-pulse 打分模型 ───────────────────────────

const TOP_SOURCES = new Set([
  "hacker-news",
  "github-trending",
  "techcrunch",
  "bbc-world",
  "qbitai",
  "36kr",
]);
const GOOD_SOURCES = new Set(["solidot", "ithome", "arxiv-cs-ai", "bbc-tech", "huanqiu"]);

/** 热度信号：多源交叉(+5) / 一线社区高分(+3) / 普通分数(+1)，映射到 0-10 */
function heatSignal(item: RawItem, multiSource: boolean): number {
  if (multiSource) return 10;
  const raw = item.stars ?? item.score ?? 0;
  if (raw >= 300) return 7.5;
  if (raw >= 80) return 6;
  if (raw >= 10) return 4;
  return 2;
}

/** 时效信号：6h(+5) / 12h(+3) / 24h(+1) / 48h(+0)，映射到 0-10 */
function timelinessSignal(item: RawItem): number {
  const ageH = (Date.now() - new Date(item.publishedAt).getTime()) / 3600_000;
  if (ageH <= 6) return 10;
  if (ageH <= 12) return 6.5;
  if (ageH <= 24) return 4;
  if (ageH <= 48) return 1.5;
  return 0;
}

/** 来源质量：一线(+3) / 二线(+2) / 其他(+1)，映射到 0-10 */
function sourceQualitySignal(item: RawItem): number {
  if (TOP_SOURCES.has(item.source)) return 10;
  if (GOOD_SOURCES.has(item.source)) return 6.5;
  return 3.5;
}

/** GitHub 项目附加 5 维度（启发式，供开源选题参考） */
function githubExtra(item: RawItem) {
  const t = item.title.toLowerCase();
  return {
    novelty: /new|first|breakthrough|novel|发布|全新/.test(t) ? 8 : 6,
    utility: /tool|framework|library|cli|api|agent|工具|框架/.test(t) ? 8 : 5,
    videoPotential: /demo|visual|3d|video|image|chart|ui/.test(t) ? 9 : 6,
  };
}

/** AI 相关性过滤：综合源（solidot/36kr 等）中的非 AI 条目归入 other 类 */
const AI_RE =
  /\b(ai|a\.i\.|llm|gpt|agent|model|transformer|diffusion|rag|copilot|openai|anthropic|claude|gemini|llama|qwen|deepseek|midjourney|stable.?diffusion)\b|[\u4e00-\u9fa5]*(人工智能|大模型|智能体|大语言模型|机器学习|深度学习|神经网络|生成式)[\u4e00-\u9fa5]*/i;

function effectiveCategory(item: ScoredItem): "ai" | "other" {
  const cat = item.category ?? "ai";
  if (cat === "ai" && !AI_RE.test(item.title) && item.source !== "hacker-news" && item.source !== "github-trending" && item.source !== "qbitai" && item.source !== "arxiv-cs-ai") {
    return "other";
  }
  return cat;
}

/** 推荐卡 Markdown 片段 */
function cardMd(item: ScoredItem, i: number): string {
  const s = item.scores;
  const gh = s.novelty
    ? ` / 新颖 ${s.novelty} / 实用 ${s.utility} / 视频化 ${s.videoPotential}`
    : "";
  const dup = item.duplicated?.length
    ? `（多源：${[item.source, ...item.duplicated].join("、")}）`
    : "";
  const lines: string[] = [
    `### ${i}.（总分 ${item.total.toFixed(1)}）`,
    "",
    `- **${item.title}**`,
    `- 链接：${item.url}`,
    `- 来源：${item.source}${dup}`,
    `- 打分：热度 ${s.heat.toFixed(1)} / 时效 ${s.timeliness.toFixed(1)} / 来源 ${s.sourceQuality.toFixed(1)}${gh}`,
  ];
  if (item.summary) lines.push(`- 摘要：${item.summary.slice(0, 120)}`);
  lines.push("");
  return lines.join("\n");
}

// ─────────────────────────── 主流程 ───────────────────────────

async function main() {
  const raw = JSON.parse(
    await readFile(path.join(RESEARCH_DIR, "raw.json"), "utf-8")
  ) as { items: RawItem[]; collectedAt?: string; date?: string };

  // 第一遍：独立打分
  const prelim = raw.items.map((item) => {
    const heat = heatSignal(item, false);
    const timeliness = timelinessSignal(item);
    const sourceQuality = sourceQualitySignal(item);
    const total = heat * 0.4 + timeliness * 0.3 + sourceQuality * 0.3;
    const scores: ScoredItem["scores"] = { heat, timeliness, sourceQuality };
    if (item.source === "github-trending") {
      Object.assign(scores, githubExtra(item));
    }
    return { ...item, scores, total } as ScoredItem;
  });

  // 去重（合并后多源条目热度信号提升）
  let scored = dedupe(prelim);
  for (const item of scored) {
    if ((item.duplicated?.length ?? 0) > 0) {
      item.scores.heat = Math.max(item.scores.heat, 10);
      item.total = item.scores.heat * 0.4 + item.scores.timeliness * 0.3 + item.scores.sourceQuality * 0.3;
    }
  }

  // 分类排序：AI 与其他新闻各取 Top（AI 3 条 + 其他 3 条组成推荐池）
  scored.sort((a, b) => b.total - a.total);
  const aiTop = scored.filter((s) => effectiveCategory(s) === "ai").slice(0, 3);
  const otherTop = scored.filter((s) => effectiveCategory(s) === "other").slice(0, 3);

  // 生成推荐卡 Markdown
  const md: string[] = [
    "# 今日推荐",
    "",
    `> 采集时间：${raw.collectedAt ?? new Date().toISOString()}`,
    "",
    "## AI 新闻 Top 3（前半场素材池）",
    "",
    ...aiTop.map((item, i) => cardMd(item, i + 1)),
    "## 其他新闻 Top 3（后半场素材池）",
    "",
    ...otherTop.map((item, i) => cardMd(item, i + 1)),
    "## AI 审核",
    "",
    "> AI 逐条判断视频化价值（画面素材/受众相关/真实数据），淘汰空话条目后确认选题。",
    "",
    "---",
    "",
    "选题确认后：AI 深度抓取原文数据 → 生成 today.json（含 narration）",
  ];

  const mdText = md.join("\n");
  await writeFile(path.join(RESEARCH_DIR, "top.md"), mdText, "utf-8");
  await writeFile(
    path.join(RESEARCH_DIR, "scored.json"),
    JSON.stringify(scored, null, 2),
    "utf-8"
  );

  // 归档
  const date = raw.date ?? new Date().toISOString().slice(0, 10);
  const archiveDir = path.join(ARCHIVE_ROOT, date);
  await mkdir(archiveDir, { recursive: true });
  await copyFile(path.join(RESEARCH_DIR, "scored.json"), path.join(archiveDir, "scored.json"));
  await copyFile(path.join(RESEARCH_DIR, "top.md"), path.join(archiveDir, "top.md"));

  console.log(`[score] 打分完成（去重后 ${scored.length} 条）→ research/today/top.md`);
  console.log("[score] AI 新闻 Top 3：");
  console.log(aiTop.map((t, i) => `  ${i + 1}. ${t.total.toFixed(1)}分 — ${t.title.slice(0, 60)}`).join("\n"));
  console.log("[score] 其他新闻 Top 3：");
  console.log(otherTop.map((t, i) => `  ${i + 1}. ${t.total.toFixed(1)}分 — ${t.title.slice(0, 60)}`).join("\n") || "  （无其他新闻源数据）");
}

main().catch((e) => {
  console.error("[score] 失败:", e);
  process.exit(1);
});
