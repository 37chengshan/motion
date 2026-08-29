/**
 * 每日调研脚本（§3.1 重构版）— 独立 stream / 独立 run / 独立归档
 *
 * 必填参数：
 *   --date YYYY-MM-DD           业务日期（禁止脚本自取系统日期）
 *   --stream ai-news|world-news|github-daily
 *   --edition morning|evening   仅新闻 stream 需要
 *
 * 输出：runs/<date>/<run>/research/raw.json（含 business_date/timezone/since/until/is_retrospective）
 * 时间窗口：windowFor(date, timezone) 纯函数；时区来自 PRODUCER_TIMEZONE（默认 Asia/Shanghai）。
 *   morning = 前一日 08:00 → 当日 08:00；evening = 当日 06:00 → 当日 17:30（两个 stream 同窗口，独立归档）。
 * 信源：只从 config/news-sources.json 注册表读取（§3.2），脚本不硬编码 URL；单源失败可跳过。
 * 门：所有实时源均失败 → 写 source_unavailable=true 并退出非零（阻止后续 script/render/package）；
 *     归档回顾内容必须显式 --retrospective（is_retrospective=true），不进入实时日报交接包。
 * 测试：RESEARCH_FIXTURE=<items.json> 环境变量注入固定条目（离线验证用，不进生产路径）。
 *
 * 用法：
 *   node scripts/daily-research.ts --date 2026-08-28 --stream ai-news --edition morning
 *   node scripts/daily-research.ts --date 2026-08-28 --stream world-news --edition evening --retrospective
 *   node scripts/daily-research.ts --date 2026-08-28 --stream github-daily
 */
import { mkdir, writeFile, readFile, readdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { markStageDone } from "./stage.ts";

const ROOT = process.cwd();

// 四方向流标识统一从单一真相源导入（避免各处重复字面量导致半迁移态）
import {
  type ResearchStream,
  NEWS_STREAMS,
  STREAM_LABEL,
  streamToCategory,
} from "../src/lib/streams.ts";

export type { ResearchStream };
export { NEWS_STREAMS, STREAM_LABEL, streamToCategory };

export type Edition = "morning" | "evening";

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  category: "ai" | "other" | "github";
  stream?: ResearchStream;
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
}

/** 信源健康条目（runs/<date>/source-health.json，dashboard /api/source-health 消费） */
export interface SourceHealthEntry {
  name: string;
  stream: ResearchStream;
  ok: boolean;
  http_status?: number | null;
  latency_ms?: number | null;
  items_count: number;
  consecutive_failures?: number;
  note: string;
}

export interface SourceEntry {
  stream: string;
  name: string;
  url: string;
  parser: "rss" | "hn-algolia" | "github-search" | "arxiv-atom";
  enabled: boolean;
  trust_level: "high" | "medium" | "low";
}

// ─────────────────────────── 时区窗口（纯函数） ───────────────────────────

const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/** 把 IANA 时区下的墙钟时间 (dateStr, hh:mm) 换算为 UTC 毫秒（含 DST，迭代 2 次收敛） */
export function zonedWallClockToUtc(dateStr: string, timezone: string, hh: number, mm: number): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
  const wallMs = (utc: number): number => {
    const parts = Object.fromEntries(
      fmt.formatToParts(new Date(utc)).map((p) => [p.type, p.value])
    );
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  };
  let utc = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) {
    const off = wallMs(utc) - utc; // 该 UTC 时刻下 zone 的墙钟偏移
    utc = Date.UTC(y, m - 1, d, hh, mm) - off;
  }
  return utc;
}

/** §3.1 固定窗口：morning = 前一日 08:00→当日 08:00；evening = 当日 06:00→17:30 */
export function windowFor(
  date: string,
  timezone: string
): { business_date: string; timezone: string; since: string; until: string } {
  if (!DATE_RE.test(date)) throw new Error("date 必须为 YYYY-MM-DD：" + date);
  const morningUntil = zonedWallClockToUtc(date, timezone, 8, 0);
  const morningSince = morningUntil - 86400_000;
  const eveningSince = zonedWallClockToUtc(date, timezone, 6, 0);
  const eveningUntil = zonedWallClockToUtc(date, timezone, 17, 30);
  return {
    business_date: date,
    timezone,
    since: new Date(morningSince).toISOString(),
    until: new Date(morningUntil).toISOString(),
  };
}

/** 时区派生：morning 用 08:00→08:00，evening 用 06:00→17:30 */
export function windowForEdition(
  date: string,
  timezone: string,
  edition: Edition
): { business_date: string; timezone: string; since: string; until: string } {
  const base = windowFor(date, timezone);
  if (edition === "morning") return base;
  return {
    business_date: date,
    timezone,
    since: new Date(zonedWallClockToUtc(date, timezone, 6, 0)).toISOString(),
    until: new Date(zonedWallClockToUtc(date, timezone, 17, 30)).toISOString(),
  };
}

// ─────────────────────────── 信源注册表 ───────────────────────────

export async function loadSourceRegistry(): Promise<SourceEntry[]> {
  const regPath = path.join(ROOT, "config", "news-sources.json");
  const raw = JSON.parse(await readFile(regPath, "utf-8")) as { sources: SourceEntry[] };
  return raw.sources ?? [];
}

// ─────────────────────────── 抓取工具 ───────────────────────────

async function fetchWithTimeout(url: string, ms = 12000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (vido-research; +https://github.com)" },
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

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
  const m = xml.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">", "i"));
  return m ? stripTags(m[1]) : "";
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function parseFeed(xml: string, source: string, category: "ai" | "other" | "github", limit = 8): NewsItem[] {
  const blocks =
    xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ??
    xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ??
    [];
  const items: NewsItem[] = [];
  for (const b of blocks.slice(0, limit)) {
    let title = pick(b, "title");
    if (!title) continue;
    title = title.slice(0, 200);
    let url = pick(b, "link");
    if (!url) {
      const m = b.match(/<link[^>]*href="([^"]+)"/i);
      url = m ? m[1] : "";
    }
    const dateRaw = pick(b, "pubDate") || pick(b, "updated") || pick(b, "published");
    const parsed = dateRaw ? new Date(dateRaw) : new Date();
    items.push({
      id: source + "-" + Math.abs(hash(title + url)),
      title,
      url: url || "",
      source,
      publishedAt: (isNaN(parsed.getTime()) ? new Date() : parsed).toISOString(),
      category,
      summary: (pick(b, "description").slice(0, 300) || pick(b, "summary").slice(0, 300)),
    });
  }
  return items;
}

// ─────────────────────────── 各 parser 实现（按注册表分流） ───────────────────────────

async function fetchByParser(
  entry: SourceEntry,
  category: "ai" | "other" | "github",
  limit = 8
): Promise<NewsItem[]> {
  const url = entry.url;
  if (entry.parser === "rss" || entry.parser === "arxiv-atom") {
    const res = await fetchWithTimeout(url);
    const xml = await res.text();
    const items = parseFeed(xml, entry.name, category, limit);
    if (!items.length) throw new Error("empty feed");
    return items;
  }
  if (entry.parser === "hn-algolia") {
    const res = await fetchWithTimeout(url);
    const data = (await res.json()) as { hits: any[] };
    const items = (data.hits ?? []).slice(0, 20).map((h) => ({
      id: "hn-" + h.objectID,
      title: (h.title ?? "").slice(0, 200),
      url: h.url ?? "https://news.ycombinator.com/item?id=" + h.objectID,
      source: "hacker-news",
      publishedAt: new Date((h.created_at_i ?? 0) * 1000).toISOString(),
      category,
      score: h.points ?? 0,
    }));
    if (!items.length) throw new Error("empty hn results");
    return items;
  }
  if (entry.parser === "github-search") {
    // github stream：候选池（含元数据字段）；ai-news stream：热门 AI 仓库
    const since = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
    const q =
      category === "github"
        ? "stars:>50 pushed:>2026-01-01"
        : "AI created:>" + since;
    const sep = url.includes("?") ? "&" : "?";
    const res = await fetchWithTimeout(url + sep + "q=" + encodeURIComponent(q) + "&sort=stars&order=desc&per_page=20");
    const data = (await res.json()) as { items: any[] };
    const items = (data.items ?? []).slice(0, 15).map((r) => ({
      id: "gh-" + r.id,
      title: r.full_name + " — " + (r.description ?? "").slice(0, 120),
      url: r.html_url,
      source: "github-trending",
      publishedAt: r.created_at ?? new Date().toISOString(),
      category,
      stars: r.stargazers_count ?? 0,
      forks: r.forks_count ?? 0,
      language: r.language ?? undefined,
      license: r.license?.spdx_id ?? undefined,
      createdAt: r.created_at ?? undefined,
      pushedAt: r.pushed_at ?? undefined,
      readmeUrl: "https://raw.githubusercontent.com/" + r.full_name + "/HEAD/README.md",
      description: r.description ?? undefined,
    }));
    if (!items.length) throw new Error("empty github results");
    return items;
  }
  throw new Error("未知 parser：" + entry.parser);
}

// ─────────────────────────── 回顾归档兜底（仅 --retrospective 显式启用） ───────────────────────────

async function buildFallbackFromArchive(): Promise<NewsItem[]> {
  try {
    const root = path.join(ROOT, "research", "archive");
    if (!existsSync(root)) return [];
    const dirs = (await readdir(root)).sort().reverse().slice(0, 3);
    const items: NewsItem[] = [];
    for (const d of dirs) {
      const dateDir = path.join(root, d);
      try {
        const files: string[] = [];
        const walk = async (dir: string) => {
          for (const f of await readdir(dir)) {
            const full = path.join(dir, f);
            if (f === "raw.json") files.push(full);
            else if (existsSync(full) && (await readdir(full)).length) await walk(full);
          }
        };
        await walk(dateDir);
        for (const rawPath of files.slice(0, 2)) {
          const data = JSON.parse(await readFile(rawPath, "utf-8")) as { items: NewsItem[] };
          items.push(...(data.items ?? []).slice(0, 10));
        }
      } catch {
        /* 单日归档损坏跳过 */
      }
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
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const has = (flag: string) => args.includes(flag);

  const date = get("--date", "");
  if (!DATE_RE.test(date)) {
    console.error("[research] 必须提供 --date YYYY-MM-DD（禁止自取系统日期）");
    process.exit(1);
  }
  const stream = get("--stream", "") as ResearchStream;
  const isNews = stream !== "github-daily";
  const isKnownStream =
    (NEWS_STREAMS as readonly string[]).includes(stream) || stream === "github-daily";
  if (!isKnownStream) {
    console.error(
      "[research] --stream 只允许 " + [...NEWS_STREAMS, "github-daily"].join("|")
    );
    process.exit(1);
  }
  const edition = get("--edition", "") as Edition;
  if (isNews && edition !== "morning" && edition !== "evening") {
    console.error("[research] 新闻 stream 必须提供 --edition morning|evening");
    process.exit(1);
  }
  const retrospective = has("--retrospective");
  const timezone = process.env.PRODUCER_TIMEZONE ?? "Asia/Shanghai";

  const runId = isNews ? stream + "-" + edition + "-" + date : "github-" + date;
  const runDir = path.resolve(
    ROOT,
    get("--run-dir", isNews ? path.join("runs", date, stream + "-" + edition) : path.join("runs", date, "github"))
  );
  const rawPath = path.resolve(ROOT, get("--out", path.join(runDir, "research", "raw.json")));

  const win = isNews ? windowForEdition(date, timezone, edition) : null;

  let items: NewsItem[] = [];
  let sourceUnavailable = false;
  let fixtureUsed = false;
  const sourceHealth: SourceHealthEntry[] = [];

  // 测试注入：RESEARCH_FIXTURE=<items.json>
  if (process.env.RESEARCH_FIXTURE) {
    const fx = JSON.parse(await readFile(path.resolve(ROOT, process.env.RESEARCH_FIXTURE), "utf-8"));
    items = (Array.isArray(fx) ? fx : fx.items ?? []).map((it: NewsItem) => ({
      ...it,
      category: streamToCategory(stream),
      stream,
    }));
    fixtureUsed = true;
    if (!items.length && !retrospective) sourceUnavailable = true;
    console.log("[research] fixture 注入 " + items.length + " 条");
  } else {
    const category = streamToCategory(stream);
    const registry = await loadSourceRegistry();
    const enabled = registry.filter(
      (s) => s.enabled && (isNews ? s.stream === stream : s.stream === "github")
    );
    if (!enabled.length) {
      console.error("[research] 注册表中没有启用的 " + stream + " 信源");
      process.exit(1);
    }
    const tasks = enabled.map((s) => fetchByParser(s, category, 8));
    const results = await Promise.allSettled(tasks);
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const src = enabled[i];
      if (r.status === "fulfilled") {
        items.push(...r.value);
        console.log("[research] " + src.name + ": " + r.value.length + " 条");
        sourceHealth.push({ name: src.name, stream, ok: true, items_count: r.value.length, note: "" });
      } else {
        const errMsg = (r.reason as Error).message;
        console.warn("[research] " + src.name + " 获取失败（跳过）: " + errMsg);
        sourceHealth.push({ name: src.name, stream, ok: false, items_count: 0, note: errMsg });
      }
    }

    // 门：实时源全失败
    if (!items.length) {
      if (retrospective) {
        items = await buildFallbackFromArchive();
        if (!items.length) {
          console.error("[research] 回顾模式也无归档可回退，退出");
          process.exit(1);
        }
        console.warn("[research] 全部信源失败，回顾版：从归档抽取 " + items.length + " 条（is_retrospective=true）");
      } else {
        sourceUnavailable = true;
        console.error("[research] 所有实时源均失败：写 source_unavailable，阻止后续 script/render/package");
      }
    }

    // 时间窗过滤（仅新闻 stream）
    if (isNews && !sourceUnavailable && win) {
      const before = items.length;
      items = items.filter((i) => i.publishedAt >= win.since && i.publishedAt <= win.until);
      if (items.length !== before) console.log("[research] 窗口过滤：剔除 " + (before - items.length) + " 条");
    }
  }

  const out = {
    business_date: date,
    timezone,
    stream,
    edition: isNews ? edition : undefined,
    since: win?.since,
    until: win?.until,
    is_retrospective: retrospective,
    source_unavailable: sourceUnavailable,
    fixture: fixtureUsed,
    collectedAt: new Date().toISOString(),
    totalItems: items.length,
    items,
  };

  await mkdir(path.dirname(rawPath), { recursive: true });
  await writeFile(rawPath, JSON.stringify(out, null, 2), "utf-8");

  // 信源健康（runs/<date>/source-health.json，dashboard /api/source-health 消费）
  // consecutive_failures：同名同 stream 源连续失败计数（成功重置为 0），供渠道健康度告警
  if (!fixtureUsed && sourceHealth.length) {
    const healthPath = path.join(ROOT, "runs", date, "source-health.json");
    const prev = JSON.parse(
      await readFile(healthPath, "utf-8").catch(() => '{"sources":[]}')
    ) as { sources: SourceHealthEntry[] };
    const prevFails = new Map(prev.sources.map((s) => [s.name + "|" + s.stream, s.consecutive_failures ?? 0]));
    const merged = sourceHealth.map((s) => ({
      ...s,
      consecutive_failures: s.ok ? 0 : (prevFails.get(s.name + "|" + s.stream) ?? 0) + 1,
    }));
    const health = {
      schema_version: 1,
      checked_at: new Date().toISOString(),
      date,
      sources: merged,
    };
    await mkdir(path.dirname(healthPath), { recursive: true });
    await writeFile(healthPath, JSON.stringify(health, null, 2), "utf-8");
    console.log("[research] 信源健康 → " + path.relative(ROOT, healthPath));
  }

  // 独立归档（research/archive/<date>/<stream>-<edition>/）
  if (items.length && !sourceUnavailable) {
    const archiveDir = path.join(ROOT, "research", "archive", date, isNews ? stream + "-" + edition : "github");
    await mkdir(archiveDir, { recursive: true });
    await copyFile(rawPath, path.join(archiveDir, "raw.json"));
  }

  if (sourceUnavailable) {
    console.error("[research] 已写 source_unavailable → " + path.relative(ROOT, rawPath));
    process.exit(1);
  }

  await markStageDone(runId, "research", {
    input_summary: "stream=" + stream + (isNews ? " edition=" + edition : "") + " 窗口 " + (win?.since ?? "-") + "→" + (win?.until ?? "-"),
    outputs: [path.relative(ROOT, rawPath)],
  });

  console.log(
    "[research] " + stream + (isNews ? " " + edition : "") + " 采集完成：" + items.length + " 条 → " +
      path.relative(ROOT, rawPath) + "（window " + (win?.since ?? "-").slice(0, 16).replace("T", " ") + " → " + (win?.until ?? "-").slice(0, 16).replace("T", " ") + "，tz=" + timezone + "）"
  );
  console.log("[research] 下一步：node scripts/score-and-rank.ts --run-dir " + path.relative(ROOT, runDir) + " --stream " + stream);
}

const isDirectRun =
  process.argv[1] &&
  (import.meta.url === new URL("file://" + path.resolve(process.argv[1])).href ||
    import.meta.url.endsWith("/" + path.basename(process.argv[1])));
if (isDirectRun) {
  main().catch((e) => {
    console.error("[research] 失败:", e);
    process.exit(1);
  });
}