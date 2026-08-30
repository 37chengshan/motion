/**
 * 打分排序脚本（§3.3 重构版）— --run-dir/--stream
 *
 * 用法：
 *   node scripts/score-and-rank.ts --run-dir runs/2026-08-28/ai-news-morning --stream ai-news
 *   node scripts/score-and-rank.ts --run-dir runs/2026-08-28/github --stream github-daily
 *
 * 输入：<run-dir>/research/raw.json（source_unavailable 时直接退出）
 * 输出（都在 run 目录 research/ 下）：
 *   scored.json             全量打分（保留原始 URL/来源引用）
 *   top.md                  Top 推荐卡
 *   selection-candidates.json  候选清单（供 select-github / 人工确认）
 *
 * 打分：ai-pulse 模型（热度×0.4 + 时效×0.3 + 来源质量×0.3），bigram Jaccard 去重；
 * GitHub 候选额外输出 stars/forks/language/license/created_at/README URL/近期活动 + 5 维评分。
 */
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { markStageDone } from "./stage.ts";
import {
  type ResearchStream,
  isResearchStream,
  allowedStreamsText,
} from "../src/lib/streams.ts";

const ROOT = process.cwd();
const ARCHIVE_ROOT = path.join(ROOT, "research", "archive");

interface RawItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  category?: "ai" | "other" | "github";
  summary?: string;
  score?: number;
  stars?: number;
  forks?: number;
  language?: string;
  license?: string;
  createdAt?: string;
  pushedAt?: string;
  readmeUrl?: string;
  description?: string;
  official?: boolean; // x-watch 官方账号动作（Phase 3）
  handle?: string;
}

interface ScoredItem extends RawItem {
  scores: {
    heat: number;
    timeliness: number;
    sourceQuality: number;
    novelty?: number;
    utility?: number;
    videoPotential?: number;
    starsSignal?: number;
  };
  total: number;
  duplicated?: string[];
}

// ─────────────────────────── 去重 ───────────────────────────

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
      if (item.total > dup.total) {
        Object.assign(dup, item, { duplicated: dup.duplicated });
      }
      continue;
    }
    result.push(item);
  }
  return result;
}

// ─────────────────────────── ai-pulse 打分 ───────────────────────────

const TOP_SOURCES = new Set(["hacker-news", "github-trending", "techcrunch", "bbc-world", "qbitai", "36kr"]);
const GOOD_SOURCES = new Set(["solidot", "ithome", "arxiv-cs-ai", "bbc-tech", "huanqiu", "chinanews"]);

function heatSignal(item: RawItem, multiSource: boolean): number {
  if (multiSource) return 10;
  const raw = item.stars ?? item.score ?? 0;
  if (raw >= 300) return 7.5;
  if (raw >= 80) return 6;
  if (raw >= 10) return 4;
  return 2;
}

function timelinessSignal(item: RawItem): number {
  const ageH = (Date.now() - new Date(item.publishedAt).getTime()) / 3600_000;
  if (ageH <= 6) return 10;
  if (ageH <= 12) return 6.5;
  if (ageH <= 24) return 4;
  if (ageH <= 48) return 1.5;
  return 0;
}

/** 信源质量：配置驱动（trust_level: high=8 / medium=6.5 / 未配置=3.5）
 *  依赖调用方从 news-sources.json 构建 trust 映射；四方向信源只在配置里维护。
 *  x-watch 官方账号动作（official=true）为最高可信一手信号 → 10 分
 */
function sourceQualitySignal(item: RawItem, trust: Map<string, string>): number {
  if (item.official) return 10;
  const level = trust.get(item.source);
  if (level === "high") return 8;
  if (level === "medium") return 6.5;
  return 3.5;
}

/** GitHub 项目附加 5 维评分（启发式，供选题参考） */
function githubExtra(item: RawItem) {
  const t = item.title.toLowerCase();
  const stars = item.stars ?? 0;
  return {
    novelty: /new|first|breakthrough|novel|发布|全新/.test(t) ? 8 : 6,
    utility: /tool|framework|library|cli|api|agent|kit|sdk/.test(t) ? 8 : 5,
    videoPotential: /demo|visual|3d|video|image|chart|ui|动画/.test(t) ? 9 : 6,
    starsSignal: stars >= 1000 ? 9 : stars >= 200 ? 7 : 4,
  };
}

function cardMd(item: ScoredItem, i: number, isGithub: boolean): string {
  const s = item.scores;
  const gh = isGithub
    ? " / 新颖 " + (s.novelty ?? 0) + " / 实用 " + (s.utility ?? 0) + " / 视频化 " + (s.videoPotential ?? 0) +
      " / Stars " + (item.stars ?? 0)
    : "";
  const dup = item.duplicated?.length ? "（多源：" + [item.source, ...item.duplicated].join("、") + "）" : "";
  const lines = [
    "### " + i + ".（总分 " + item.total.toFixed(1) + "）",
    "",
    "- **" + item.title + "**",
    "- 链接：" + item.url,
    "- 来源：" + item.source + dup,
    "- 打分：热度 " + s.heat.toFixed(1) + " / 时效 " + s.timeliness.toFixed(1) + " / 来源 " + s.sourceQuality.toFixed(1) + gh,
  ];
  if (isGithub) {
    lines.push(
      "- 元数据：stars=" + (item.stars ?? "-") + " forks=" + (item.forks ?? "-") +
        " lang=" + (item.language ?? "-") + " license=" + (item.license ?? "-") +
        " created=" + (item.createdAt ?? "-").slice(0, 10) +
        " pushed=" + (item.pushedAt ?? "-").slice(0, 10)
    );
    lines.push("- README：" + (item.readmeUrl ?? "-"));
  }
  if (item.summary) lines.push("- 摘要：" + item.summary.slice(0, 120));
  lines.push("");
  return lines.join("\n");
}

// ─────────────────────────── 主流程 ───────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };

  const runDirFlag = get("--run-dir", "");
  if (!runDirFlag) {
    console.error("[score] 必须提供 --run-dir");
    process.exit(1);
  }
  const runDir = path.resolve(ROOT, runDirFlag);
  const streamRaw = get("--stream", "");
  if (!isResearchStream(streamRaw)) {
    console.error("[score] --stream 只允许 " + allowedStreamsText());
    process.exit(1);
  }
  const stream: ResearchStream = streamRaw;
  const isGithub = stream === "github-daily";
  // degraded 兜底：子代理超时/失败时，按分数取 top 补位（不依赖 agent 会话）
  const fallbackOnly = args.includes("--fallback-only");
  const limit = parseInt(get("--limit", ""), 10);
  const researchDir = path.join(runDir, "research");
  const rawPath = path.join(researchDir, "raw.json");
  const xwatchPath = path.join(researchDir, "x-watch.json");

  let raw: { items: RawItem[]; source_unavailable?: boolean; business_date?: string; timezone?: string };
  try {
    raw = JSON.parse(await readFile(rawPath, "utf-8"));
  } catch {
    // 无 raw.json（仅跑 x-watch 的 run）→ 回退用 x-watch 作为输入
    try {
      const xw = JSON.parse(await readFile(xwatchPath, "utf-8")) as {
        items?: RawItem[]; business_date?: string; source_unavailable?: boolean;
      };
      raw = { items: xw.items ?? [], business_date: xw.business_date, source_unavailable: xw.source_unavailable };
      console.log("[score] raw.json 缺失，回退使用 x-watch.json 作为输入（" + raw.items.length + " 条）");
    } catch {
      console.error("[score] 无法读取 raw.json：" + rawPath);
      process.exit(1);
    }
  }
  if (raw.source_unavailable) {
    console.error("[score] raw.json 标记 source_unavailable，禁止进入评分（先修研究阶段）");
    process.exit(1);
  }
  const date = raw.business_date ?? new Date().toISOString().slice(0, 10);

  // 信源质量改为配置驱动（news-sources.json 的 trust_level）——
  // 四方向新增信源只改配置即可正确打分，无需改代码（修复：硬编码集合漏新源 → 恒 3.5 分无区分度）
  const trustBySource = new Map<string, string>();
  try {
    const registry = JSON.parse(
      await readFile(path.join(ROOT, "config", "news-sources.json"), "utf-8")
    );
    for (const s of registry.sources ?? []) {
      trustBySource.set(s.name, s.trust_level ?? "low");
    }
  } catch {
    console.warn("[score] news-sources.json 读取失败，sourceQuality 回退默认值");
  }

  // 合并 x-watch 官方账号动作（若存在）：官方一手信号 → 高可信选题
  const allRaw: RawItem[] = [...(raw.items ?? [])];
  try {
    const xwatch = JSON.parse(await readFile(xwatchPath, "utf-8")) as {
      items?: (RawItem & { official?: boolean; handle?: string })[];
    };
    if (xwatch.items?.length) {
      const before = allRaw.length;
      for (const it of xwatch.items) {
        allRaw.push({ ...it, category: it.category ?? "ai", official: it.official ?? true });
      }
      console.log(`[score] 合并 x-watch 官方动作 ${allRaw.length - before} 条`);
    }
  } catch {
    /* 无 x-watch.json（未采集 X）则跳过 */
  }

  const prelim: ScoredItem[] = allRaw.map((item) => {
    const heat = heatSignal(item, false);
    const timeliness = timelinessSignal(item);
    const sourceQuality = sourceQualitySignal(item, trustBySource);
    let total = heat * 0.4 + timeliness * 0.3 + sourceQuality * 0.3;
    const scores: ScoredItem["scores"] = { heat, timeliness, sourceQuality };
    if (isGithub) {
      const extra = githubExtra(item);
      Object.assign(scores, extra);
      total = heat * 0.25 + timeliness * 0.2 + sourceQuality * 0.15 + extra.starsSignal * 0.4;
    }
    return { ...item, scores, total };
  });

  let scored = dedupe(prelim);
  for (const item of scored) {
    if ((item.duplicated?.length ?? 0) > 0) {
      item.scores.heat = Math.max(item.scores.heat, 10);
      item.total = isGithub
        ? item.scores.heat * 0.25 + item.scores.timeliness * 0.2 + item.scores.sourceQuality * 0.15 + (item.scores.starsSignal ?? 0) * 0.4
        : item.scores.heat * 0.4 + item.scores.timeliness * 0.3 + item.scores.sourceQuality * 0.3;
    }
  }
  scored.sort((a, b) => b.total - a.total);
  // --limit 可覆盖 topN 条数（degraded 补位时按配额取）
  const topCount = Number.isInteger(limit) && limit > 0 ? limit : isGithub ? 5 : 3;
  const topN = scored.slice(0, topCount);

  const md: string[] = [
    "# 今日推荐（" + stream + "）",
    "",
    "> 采集时间：" + (raw.business_date ?? date),
    "",
    isGithub ? "## GitHub 候选 Top 5（供 select-github 生成 3 张推荐卡）" : "## Top " + topN.length,
    "",
    ...topN.map((item, i) => cardMd(item, i + 1, isGithub)),
    "---",
    "",
    isGithub
      ? "人工确认后写入 selection.json（1–2 个仓库），再走 generate-github-config。"
      : "选题确认后：generate-content.ts 抓取原文快照 → 生成 config/content.json。",
  ];
  const mdText = md.join("\n");

  await mkdir(researchDir, { recursive: true });
  await writeFile(path.join(researchDir, "scored.json"), JSON.stringify(scored, null, 2), "utf-8");
  await writeFile(path.join(researchDir, "top.md"), mdText, "utf-8");
  await writeFile(
    path.join(researchDir, "selection-candidates.json"),
    JSON.stringify(
      {
        stream,
        date,
        generated_at: new Date().toISOString(),
        candidates: topN.map((c) => ({
          id: c.id,
          title: c.title,
          url: c.url,
          source: c.source,
          total: c.total,
          ...(isGithub
            ? {
                stars: c.stars, forks: c.forks, language: c.language, license: c.license,
                createdAt: c.createdAt, pushedAt: c.pushedAt, readmeUrl: c.readmeUrl,
                scores: c.scores,
              }
            : { summary: c.summary, scores: c.scores }),
        })),
      },
      null,
      2
    ),
    "utf-8"
  );

  // ── degraded 兜底：--fallback-only 直接产出统一 selection.json ──
  // 供「子代理超时/失败」时补位：generate-content --selection 消费，不开第二输入分支。
  if (fallbackOnly) {
    const selection = {
      selected_by: "score-fallback",
      selected_at: new Date().toISOString(),
      stream,
      date,
      quota: topN.length,
      items: topN.map((c) => ({
        id: c.id,
        url: c.url,
        title: c.title,
        stream,
        total: c.total,
      })),
    };
    const selPath = path.join(researchDir, "selection.json");
    await writeFile(selPath, JSON.stringify(selection, null, 2), "utf-8");
    console.log(
      "[score] --fallback-only：已按分数取 top " +
        topN.length +
        " 条 → " +
        path.relative(ROOT, selPath)
    );
  }

  // 归档（独立 stream/edition）
  const archiveDir = path.join(ARCHIVE_ROOT, date, path.basename(runDir));
  await mkdir(archiveDir, { recursive: true });
  await copyFile(path.join(researchDir, "scored.json"), path.join(archiveDir, "scored.json"));
  await copyFile(path.join(researchDir, "top.md"), path.join(archiveDir, "top.md"));

  const runId = stream === "github-daily" ? "github-" + date : path.basename(runDir) + "-" + date;
  await markStageDone(runId, "score", {
    input_summary: "scored " + scored.length + " 条",
    outputs: [
      path.relative(ROOT, path.join(researchDir, "scored.json")),
      path.relative(ROOT, path.join(researchDir, "top.md")),
      path.relative(ROOT, path.join(researchDir, "selection-candidates.json")),
    ],
  });

  console.log("[score] " + stream + " 打分完成（去重后 " + scored.length + " 条）→ " + path.relative(ROOT, path.join(researchDir, "top.md")));
  topN.slice(0, 3).forEach((t, i) => console.log("  " + (i + 1) + ". " + t.total.toFixed(1) + "分 — " + t.title.slice(0, 60)));
}

const isDirectRun =
  process.argv[1] &&
  (import.meta.url === new URL("file://" + path.resolve(process.argv[1])).href ||
    import.meta.url.endsWith("/" + path.basename(process.argv[1])));
if (isDirectRun) {
  main().catch((e) => {
    console.error("[score] 失败:", e);
    process.exit(1);
  });
}