/**
 * 每日调研脚本 — 15 信源采集（AI 新闻 10 源 + 其他新闻 5 源）
 *
 * AI 新闻类（category: "ai"）：
 *   1. Hacker News (Algolia API)      2. GitHub Trending (Search API)
 *   3. 量子位 RSS                     4. 36氪 RSS
 *   5. Solidot RSS                    6. 雷锋网 RSS
 *   7. 钛媒体 RSS                     8. IT之家 RSS
 *   9. TechCrunch RSS                10. arXiv cs.AI (export API)
 *
 * 其他新闻类（category: "other"，国际/综合为主）：
 *  11. BBC World RSS                 12. 环球网 RSS
 *  13. Solidot 非AI（复用）           14. IT之家综合（复用）
 *  15. 36氪综合（复用）
 *
 * 容错：单源失败降级跳过；全部失败输出回顾版（从 research/archive/ 最近 3 天抽取）
 * 归档：每日产物复制到 research/archive/YYYY-MM-DD/
 *
 * 用法：
 *   npm run research                                # 默认 → research/today/raw.json（兼容旧用法）
 *   npm run research -- --edition morning           # 早场：窗口=昨 08:00→今 08:00 → research/morning/raw.json
 *   npm run research -- --edition evening           # 晚场：窗口=今 06:00→17:30 → research/evening/raw.json
 *   npm run research -- --since 2026-08-27T00:00:00Z --until ... --out research/custom
 * 输出：research/today/raw.json（含 items[].category: "ai" | "other"）
 *
 * 场次窗口为有意重叠设计（早场覆盖昨夜-今晨，晚场覆盖白天），两场产物按目录隔离。
 */
import { mkdir, writeFile, readFile, readdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  category: "ai" | "other";
  score?: number;
  stars?: number;
  summary?: string;
}

const DEFAULT_DIR = path.resolve(process.cwd(), "research", "today");
const ARCHIVE_ROOT = path.resolve(process.cwd(), "research", "archive");

/** 场次默认时间窗（有意重叠设计）：早场=昨08:00→今08:00；晚场=今06:00→17:30 */
function windowFor(edition: string | undefined): { since: string; until: string } | null {
  if (!edition) return null;
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  if (edition === "morning") {
    return {
      since: new Date(y, m, d - 1, 8, 0, 0).toISOString(),
      until: new Date(y, m, d, 8, 0, 0).toISOString(),
    };
  }
  if (edition === "evening") {
    return {
      since: new Date(y, m, d, 6, 0, 0).toISOString(),
      until: new Date(y, m, d, 17, 30, 0).toISOString(),
    };
  }
  return null;
}

async function fetchWithTimeout(url: string, ms = 12000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (vido-research; +https://github.com)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────── RSS/Atom 轻量解析 ───────────────────────────

const stripTags = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();

const pick = (xml: string, tag: string): string => {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? stripTags(m[1]) : "";
};

/** 解析 RSS <item> 与 Atom <entry>，输出标准 NewsItem */
function parseFeed(xml: string, source: string, category: "ai" | "other", limit = 8): NewsItem[] {
  const blocks =
    xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ??
    xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ??
    [];
  const items: NewsItem[] = [];
  for (const b of blocks.slice(0, limit)) {
    let title = pick(b, "title");
    if (!title) continue;
    title = title.slice(0, 200);
    // link：RSS <link>text</link>；Atom <link href=".."/>
    let url = pick(b, "link");
    if (!url) {
      const m = b.match(/<link[^>]*href="([^"]+)"/i);
      url = m ? m[1] : "";
    }
    const dateRaw = pick(b, "pubDate") || pick(b, "updated") || pick(b, "published");
    const parsed = dateRaw ? new Date(dateRaw) : new Date();
    items.push({
      id: `${source}-${Math.abs(hash(title + url))}`,
      title,
      url: url || "",
      source,
      publishedAt: (isNaN(parsed.getTime()) ? new Date() : parsed).toISOString(),
      category,
      summary: pick(b, "description").slice(0, 300) || pick(b, "summary").slice(0, 300),
    });
  }
  return items;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

async function fetchRss(
  name: string,
  url: string,
  category: "ai" | "other",
  limit = 8
): Promise<NewsItem[]> {
  try {
    const res = await fetchWithTimeout(url);
    const xml = await res.text();
    const items = parseFeed(xml, name, category, limit);
    if (!items.length) throw new Error("empty feed");
    console.log(`[research] ${name}: ${items.length} 条`);
    return items;
  } catch (e) {
    console.warn(`[research] ${name} 获取失败（跳过）: ${(e as Error).message}`);
    return [];
  }
}

// ─────────────────────────── 各数据源 ───────────────────────────

/** Hacker News（Algolia API，无需 key） */
async function fetchHackerNews(): Promise<NewsItem[]> {
  try {
    const url =
      "https://hn.algolia.com/api/v1/search_by_date?query=AI&tags=story&hitsPerPage=30";
    const res = await fetchWithTimeout(url);
    const data = (await res.json()) as { hits: any[] };
    const items = data.hits.slice(0, 20).map((h) => ({
      id: `hn-${h.objectID}`,
      title: (h.title ?? "").slice(0, 200),
      url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
      source: "hacker-news",
      publishedAt: new Date((h.created_at_i ?? 0) * 1000).toISOString(),
      category: "ai" as const,
      score: h.points ?? 0,
    }));
    console.log(`[research] hacker-news: ${items.length} 条`);
    return items;
  } catch (e) {
    console.warn(`[research] hacker-news 失败（跳过）: ${(e as Error).message}`);
    return [];
  }
}

/** GitHub Trending（Search API，近两周新建，按 star 排序） */
async function fetchGithubTrending(): Promise<NewsItem[]> {
  try {
    const since = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
    const url = `https://api.github.com/search/repositories?q=AI+created:>${since}&sort=stars&order=desc&per_page=20`;
    const res = await fetchWithTimeout(url);
    const data = (await res.json()) as { items: any[] };
    const items = (data.items ?? []).slice(0, 15).map((r) => ({
      id: `gh-${r.id}`,
      title: `${r.full_name} — ${(r.description ?? "").slice(0, 120)}`,
      url: r.html_url,
      source: "github-trending",
      publishedAt: r.created_at ?? new Date().toISOString(),
      category: "ai" as const,
      stars: r.stargazers_count ?? 0,
    }));
    console.log(`[research] github-trending: ${items.length} 条`);
    return items;
  } catch (e) {
    console.warn(`[research] github-trending 失败（跳过）: ${(e as Error).message}`);
    return [];
  }
}

/** arXiv cs.AI 新论文（export API，Atom 格式） */
async function fetchArxiv(): Promise<NewsItem[]> {
  return fetchRss(
    "arxiv-cs-ai",
    "http://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=8",
    "ai",
    8
  );
}

// ─────────────────────────── 回顾版（全部失败兜底） ───────────────────────────

async function buildFallbackFromArchive(): Promise<NewsItem[]> {
  try {
    const dirs = (await readdir(ARCHIVE_ROOT)).sort().reverse().slice(0, 3);
    const items: NewsItem[] = [];
    for (const d of dirs) {
      try {
        // 兼容两种归档布局：<date>/raw.json 与 <date>/<edition>/raw.json
        let rawPath = path.join(ARCHIVE_ROOT, d, "raw.json");
        if (!existsSync(rawPath)) {
          const dateDir = path.join(ARCHIVE_ROOT, d);
          const editionDirs = (await readdir(dateDir)).filter((x) => x === "morning" || x === "evening");
          if (editionDirs.length) rawPath = path.join(dateDir, editionDirs[0], "raw.json");
        }
        const raw = await readFile(rawPath, "utf-8");
        const data = JSON.parse(raw) as { items: NewsItem[] };
        items.push(...(data.items ?? []).slice(0, 10));
      } catch {
        /* 单日归档损坏跳过 */
      }
    }
    if (items.length) {
      console.warn(`[research] 全部信源失败，回顾版：从归档抽取 ${items.length} 条`);
    }
    return items;
  } catch {
    return [];
  }
}

// ─────────────────────────── 主流程 ───────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const edition = get("--edition", ""); // morning | evening（空=默认单场）
  const win = windowFor(edition || undefined);
  const since = win ? get("--since", win.since) : get("--since", "");
  const until = win ? get("--until", win.until) : get("--until", "");
  const RESEARCH_DIR = path.resolve(
    process.cwd(),
    get("--out", edition ? `research/${edition}` : "research/today")
  );

  await mkdir(RESEARCH_DIR, { recursive: true });
  console.log(
    `[research] 开始采集（${edition ? edition + " 场" : "默认单场"}${since ? "，窗口 " + since.slice(0, 16).replace("T", " ") + " → " + until.slice(0, 16).replace("T", " ") : ""}）…`
  );

  const tasks: Promise<NewsItem[]>[] = [
    // AI 新闻类（10 源：AI 垂直/开发者社区为主）
    fetchHackerNews(),
    fetchGithubTrending(),
    fetchRss("qbitai", "https://www.qbitai.com/feed", "ai", 8), // 量子位（纯 AI）
    fetchRss("36kr", "https://36kr.com/feed", "ai", 8),
    fetchRss("solidot", "https://www.solidot.org/index.rss", "ai", 8),
    fetchRss("leiphone", "https://www.leiphone.com/feed", "ai", 6), // 雷锋网（AI/硬件）
    fetchRss("tmtpost", "https://www.tmtpost.com/feed", "ai", 6), // 钛媒体
    fetchRss("techcrunch", "https://techcrunch.com/feed/", "ai", 8),
    fetchArxiv(),
    // 其他新闻类（综合科技/国际，5 路；海外源失败自动降级）
    fetchRss("ithome", "https://www.ithome.com/rss/", "other", 10), // IT之家综合
    fetchRss("bbc-world", "https://feeds.bbci.co.uk/news/world/rss.xml", "other", 10),
    fetchRss("huanqiu", "https://rss.huanqiu.com/world.xml", "other", 8), // 环球网国际
    fetchRss("chinanews", "https://www.chinanews.com.cn/rss/scroll.xml", "other", 8), // 中新网滚动
    fetchRss("bbc-tech", "https://feeds.bbci.co.uk/news/technology/rss.xml", "other", 6),
  ];

  const results = await Promise.allSettled(tasks);
  let items: NewsItem[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") items.push(...r.value);
  }

  // 全部失败 → 回顾版
  if (!items.length) {
    items = await buildFallbackFromArchive();
    if (!items.length) {
      console.error("[research] 无任何数据且无归档可回退，退出");
      process.exit(1);
    }
  }

  // 时间窗过滤（--edition 自动带默认窗口；显式 --since/--until 覆盖）
  if (since) {
    const before = items.length;
    items = items.filter((i) => i.publishedAt >= since);
    if (items.length !== before) console.log(`[research] 窗口过滤：${before - items.length} 条早于 ${since.slice(0, 16)} 被剔除`);
  }
  if (until) {
    const before = items.length;
    items = items.filter((i) => i.publishedAt <= until);
    if (items.length !== before) console.log(`[research] 窗口过滤：${before - items.length} 条晚于 ${until.slice(0, 16)} 被剔除`);
  }

  const aiCount = items.filter((i) => i.category === "ai").length;
  const otherCount = items.filter((i) => i.category === "other").length;

  const out = {
    date: new Date().toISOString().slice(0, 10),
    collectedAt: new Date().toISOString(),
    totalItems: items.length,
    stats: { ai: aiCount, other: otherCount },
    items,
  };

  const rawPath = path.join(RESEARCH_DIR, "raw.json");
  await writeFile(rawPath, JSON.stringify(out, null, 2), "utf-8");

  // 每日归档（回顾版地基；场次隔离：archive/<date>/<edition>/）
  const today = out.date;
  const archiveDir = edition
    ? path.join(ARCHIVE_ROOT, today, edition)
    : path.join(ARCHIVE_ROOT, today);
  await mkdir(archiveDir, { recursive: true });
  await copyFile(rawPath, path.join(archiveDir, "raw.json"));

  console.log(
    `[research] 采集完成：${items.length} 条（AI ${aiCount} / 其他 ${otherCount}）→ ${path.relative(process.cwd(), rawPath)}`
  );
  console.log(`[research] 已归档 → research/archive/${today}/${edition}/`);
  console.log("[research] 下一步：npm run score（AI 打分 + 生成 Top 推荐卡）");
}

main().catch((e) => {
  console.error("[research] 失败:", e);
  process.exit(1);
});
