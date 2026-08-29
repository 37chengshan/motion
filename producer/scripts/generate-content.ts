/**
 * 内容配置生成脚本（新闻日报专属）— 计划 §2.6
 *
 * 读取 scored.json / 人工 selection，抓取或读取已核实的原文快照（sha256 绑定），
 * 调用文本模型按 stream 生成 config/content.json。
 *
 * 硬性契约（违反即退出非零，绝不生成可打包配置）：
 *  - 每个 content block 固定含：事实(facts)、来源 URL、source snapshot hash、
 *    摘要(summary)、要点(points)、数字(stats/highlight)、narration 和声明(disclaimer)；
 *  - 模型输出的 url 必须是已核实项的真实 URL，sourceSnapshotHash 必须等于快照 sha256；
 *  - provider 不可用 / 输出无法解析 / 任何事实无法绑定来源 → 停止，不写 content.json。
 *
 * 环境变量（只注入，不落盘）：
 *   CONTENT_PROVIDER=openai|anthropic|fixture   （默认 openai）
 *   CONTENT_BASE_URL=...                        （openai 默认 https://api.openai.com/v1；
 *                                                 anthropic 默认 https://api.anthropic.com）
 *   CONTENT_MODEL=...                           （默认 gpt-4o-mini / claude-3-5-sonnet-latest）
 *   CONTENT_API_KEY=...                         （fixture 模式不需要）
 *   GENERATE_FIXTURE=/abs/path.json              （fixture 模式：直接读取该文件作为模型回复文本）
 *
 * 用法（producer/ 下执行）：
 *   node scripts/generate-content.ts \
 *     --run-dir runs/2026-08-28/ai-news-morning \
 *     --date 2026-08-28 --stream ai-news --edition morning \
 *     [--scored runs/2026-08-28/ai-news-morning/research/scored.json] \
 *     [--selection .../selection.json] [--count 3] [--style minimal-tech] \
 *     [--fetch-snapshots] [--title "..." ] [--out ...]
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type {
  VideoBlock,
  VideoConfig,
  VideoStyle,
  StreamId,
  EditionId,
} from "../src/data/types.ts";
import { runDirPaths } from "../src/data/timeline.ts";

const ROOT = process.cwd();

const NEWS_SECTIONS: Record<StreamId, string[]> = {
  "ai-news": ["ai-news", "review-ai"],
  "world-news": ["other-news", "review-other"],
};
const VALID_STYLES: VideoStyle[] = [
  "minimal-tech",
  "whiteboard",
  "sticky-notes",
  "newspaper",
  "journal",
];
const DEFAULT_DISCLAIMER = "以上内容由 AI 汇总整理，事实以原文链接与快照为准。";

// ─────────────────────────── 输入类型 ───────────────────────────

interface ScoredItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  category?: "ai" | "other";
  stream?: StreamId;
  summary?: string;
  total?: number;
  scores?: Record<string, number>;
}

interface SelectionFile {
  run_id?: string;
  date?: string;
  stream?: string;
  edition?: string;
  selected_by?: string;
  selected_at?: string;
  items: { id?: string; url?: string; title?: string }[];
}

interface GeneratedBlock {
  type?: string;
  content?: string;
  summary?: string;
  facts?: string[];
  points?: string[];
  stats?: { label?: string; value?: string }[];
  highlight?: string;
  narration?: string;
  disclaimer?: string;
  section?: string;
  url?: string;
  sourceSnapshotHash?: string;
}

interface SnapshotInfo {
  key: string;
  path: string;
  content: string;
  sha256: string;
  url: string;
}

// ─────────────────────────── CLI 解析 ───────────────────────────

function parseArgs(): {
  get: (flag: string, fallback: string) => string;
  has: (flag: string) => boolean;
} {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const has = (flag: string) => args.includes(flag);
  return { get, has };
}

function fail(msg: string): never {
  console.error("[generate-content] " + msg);
  process.exit(1);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ─────────────────────────── 快照与哈希 ───────────────────────────

/** 轻量 Web 抓取（限时），失败抛错 */
async function fetchText(url: string, ms = 15000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (vido-producer; +https://github.com)" },
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const sha256 = (s: string): string =>
  createHash("sha256").update(s, "utf-8").digest("hex");

const snapshotKey = (item: ScoredItem): string =>
  (item.id || item.url)
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";

/** 取回并固定原文快照：优先读本地，其次 --fetch-snapshots 抓取；都不行则失败 */
async function resolveSnapshot(
  item: ScoredItem,
  snapshotDir: string,
  fetchEnabled: boolean
): Promise<SnapshotInfo> {
  const key = snapshotKey(item);
  const snapPath = path.join(snapshotDir, key + ".txt");

  let content: string;
  if (existsSync(snapPath)) {
    content = await readFile(snapPath, "utf-8");
  } else if (fetchEnabled) {
    content = await fetchText(item.url);
    await mkdir(snapshotDir, { recursive: true });
    await writeFile(snapPath, content, "utf-8");
  } else {
    fail(
      "缺少已核实快照：" + item.url + "\n  " +
        "处理：加 --fetch-snapshots 在线抓取，或预先放置 " + path.relative(ROOT, snapPath)
    );
  }
  if (!content || !content.trim()) {
    fail("原文快照为空：" + item.url);
  }
  return { key, path: snapPath, content, sha256: sha256(content), url: item.url };
}

// ─────────────────────────── LLM provider ───────────────────────────

type ProviderName = "openai" | "anthropic" | "fixture";

function providerConfig(): {
  name: ProviderName;
  baseUrl: string;
  model: string;
  apiKey: string;
} {
  const name = (process.env.CONTENT_PROVIDER ?? "openai") as ProviderName;
  if (name !== "openai" && name !== "anthropic" && name !== "fixture") {
    fail("CONTENT_PROVIDER 只允许 openai|anthropic|fixture，收到：" + name);
  }
  const defaults: Record<ProviderName, { baseUrl: string; model: string }> = {
    openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
    anthropic: { baseUrl: "https://api.anthropic.com", model: "claude-3-5-sonnet-latest" },
    fixture: { baseUrl: "", model: "fixture" },
  };
  if (name === "fixture") {
    if (!process.env.GENERATE_FIXTURE) {
      fail("fixture 模式需要 GENERATE_FIXTURE=<模型回复文件路径>");
    }
    return { name, baseUrl: "", model: "fixture", apiKey: "" };
  }
  const apiKey = process.env.CONTENT_API_KEY ?? "";
  if (!apiKey) fail("CONTENT_API_KEY 未设置（provider=" + name + "）");
  const baseUrl = (process.env.CONTENT_BASE_URL || defaults[name].baseUrl).replace(/\/+$/, "");
  return { name, baseUrl, model: process.env.CONTENT_MODEL || defaults[name].model, apiKey };
}

/** 提取回复中第一个平衡的 JSON 数组文本 */
function extractJsonArray(text: string): string {
  const clean = text.replace(/\u0060\u0060\u0060(?:json)?/gi, "").replace(/\u0060\u0060\u0060/g, "").trim();
  const start = clean.indexOf("[");
  if (start === -1) fail("模型回复中没有 JSON 数组（blocks）");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < clean.length; i++) {
    const ch = clean[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return clean.slice(start, i + 1);
    }
  }
  fail("模型回复 JSON 数组未闭合");
}

async function callProvider(
  provider: ReturnType<typeof providerConfig>,
  messages: { role: "system" | "user"; content: string }[]
): Promise<string> {
  if (provider.name === "fixture") {
    return await readFile(process.env.GENERATE_FIXTURE as string, "utf-8");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    if (provider.name === "openai") {
      const res = await fetch(provider.baseUrl + "/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + provider.apiKey,
        },
        body: JSON.stringify({
          model: provider.model,
          messages,
          temperature: 0.4,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        fail("文本模型 " + res.status + "：" + body.slice(0, 300));
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) fail("文本模型返回空内容");
      return content;
    }
    const res = await fetch(provider.baseUrl + "/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: 8192,
        system: messages.find((m) => m.role === "system")?.content ?? "",
        messages: messages
          .filter((m) => m.role === "user")
          .map((m) => ({ role: "user", content: m.content })),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      fail("文本模型 " + res.status + "：" + body.slice(0, 300));
    }
    const data = (await res.json()) as {
      content?: { type?: string; text?: string }[];
    };
    const text = (data.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
    if (!text) fail("文本模型返回空内容");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────── 校验 ───────────────────────────

interface Bindings {
  urlToHash: Map<string, string>;
  urlToItem: Map<string, ScoredItem>;
}

function validateBlocks(
  blocks: GeneratedBlock[],
  bindings: Bindings,
  stream: StreamId
): { out: GeneratedBlock[]; errors: string[] } {
  const errors: string[] = [];
  const { urlToHash } = bindings;

  if (!Array.isArray(blocks) || blocks.length === 0) {
    return { out: [], errors: ["模型输出为空或不是数组"] };
  }

  blocks.forEach((b, i) => {
    if (typeof b !== "object" || b === null) {
      errors.push("block[" + i + "] 不是对象");
      return;
    }
    const label = "block[" + i + "]";
    const content = (b.content ?? "").trim();
    const narration = (b.narration ?? "").trim();
    if (!content) errors.push(label + " 缺少 content");
    if (!narration) errors.push(label + " 缺少 narration");

    if (b.type === "title" || b.type === "divider") return; // 开场/转场块不要求来源绑定

    const url = (b.url ?? "").trim();
    const hash = (b.sourceSnapshotHash ?? "").trim();
    if (!url) errors.push(label + " 缺少来源 URL");
    else if (!urlToHash.has(url)) errors.push(label + " 来源 URL 不在已核实列表：" + url);
    if (!hash) errors.push(label + " 缺少 sourceSnapshotHash");
    else if (url && urlToHash.get(url) !== hash) {
      errors.push(label + " sourceSnapshotHash 与快照不一致（url=" + url + "）");
    }
    if (!Array.isArray(b.facts) || b.facts.length === 0 || b.facts.some((f) => !(f ?? "").trim())) {
      errors.push(label + " 缺少非空 facts[]（事实必须绑定来源）");
    }
    if (!(b.summary ?? "").trim()) errors.push(label + " 缺少 summary");
    if (!Array.isArray(b.points) || b.points.length === 0 || b.points.some((p) => !(p ?? "").trim())) {
      errors.push(label + " 缺少非空 points[]");
    }
    const hasStats = Array.isArray(b.stats) && b.stats.length > 0;
    const hasHighlight = Boolean((b.highlight ?? "").trim());
    if (!hasStats && !hasHighlight) errors.push(label + " 缺少数字（stats[] 或 highlight）");
    if (b.stats) {
      b.stats.forEach((s, k) => {
        if (!(s.label ?? "").trim() || !(s.value ?? "").trim()) {
          errors.push(label + " stats[" + k + "] label/value 不能为空");
        }
      });
    }
    if (!(b.disclaimer ?? "").trim()) errors.push(label + " 缺少 disclaimer（声明）");

    // section 必须与 stream 匹配
    if (b.section) {
      const allowed = NEWS_SECTIONS[stream];
      if (!allowed.includes(b.section)) {
        errors.push(label + " section=" + b.section + " 不属于 " + stream + "（允许：" + allowed.join("|") + "）");
      }
    }
  });

  return {
    out: blocks,
    errors,
  };
}

// ─────────────────────────── 主流程 ───────────────────────────

async function main() {
  const { get, has } = parseArgs();

  const runDirFlag = get("--run-dir", "");
  if (!runDirFlag) fail("必须提供 --run-dir（如 runs/2026-08-28/ai-news-morning）");
  const runDir = path.resolve(ROOT, runDirFlag);
  const runPaths = runDirPaths(runDir);

  const date = get("--date", "");
  if (!DATE_RE.test(date)) fail("--date 必须为 YYYY-MM-DD，收到：" + date);
  const stream = get("--stream", "") as StreamId;
  if (stream !== "ai-news" && stream !== "world-news") fail("--stream 只允许 ai-news|world-news，收到：" + stream);
  const edition = get("--edition", "") as EditionId;
  if (edition !== "morning" && edition !== "evening") fail("--edition 只允许 morning|evening，收到：" + edition);

  const runId = path.basename(runDir) + "-" + date;
  const style = get("--style", "minimal-tech") as VideoStyle;
  if (!VALID_STYLES.includes(style)) fail("--style 非法：" + style + "（允许 " + VALID_STYLES.join("|") + "）");
  const count = parseInt(get("--count", "3"), 10);
  if (!Number.isInteger(count) || count < 1 || count > 8) fail("--count 必须在 1–8");
  const fetchSnapshots = has("--fetch-snapshots");

  const scoredPath = path.resolve(ROOT, get("--scored", path.join(runDir, "research", "scored.json")));
  const snapshotDir = path.resolve(ROOT, get("--snapshot-dir", path.join(runDir, "research", "snapshots")));
  const outPath = path.resolve(ROOT, get("--out", runPaths.configPath));

  // 1) 读取打分结果
  let scored: ScoredItem[];
  try {
    const raw = JSON.parse(await readFile(scoredPath, "utf-8"));
    scored = Array.isArray(raw) ? raw : (raw.items ?? []);
  } catch {
    fail("无法读取 scored.json：" + path.relative(ROOT, scoredPath));
  }

  // 2) 按 stream 过滤（兼容新老字段：stream / category）
  let items = scored.filter(
    (it) =>
      (it.stream && it.stream === stream) ||
      (!it.stream && (it.category ?? "ai") === (stream === "ai-news" ? "ai" : "other"))
  );
  if (items.length === 0) fail("scored.json 中没有任何 " + stream + " 条目");

  // 3) 人工 selection 可覆盖 top-N（只保留被选中的项，按选择顺序）
  const selectionFlag = get("--selection", "");
  if (selectionFlag) {
    const selPath = path.resolve(ROOT, selectionFlag);
    let sel: SelectionFile;
    try {
      sel = JSON.parse(await readFile(selPath, "utf-8")) as SelectionFile;
    } catch {
      fail("无法读取 selection：" + path.relative(ROOT, selPath));
    }
    const wanted = sel.items ?? [];
    if (wanted.length === 0) fail("selection.json 的 items 为空");
    const picked: ScoredItem[] = [];
    for (const w of wanted) {
      const hit = items.find(
        (it) => (w.url && it.url === w.url) || (w.id && it.id === w.id)
      );
      if (!hit) fail("selection 引用了未打分的条目：" + (w.url ?? w.id ?? w.title ?? "?"));
      if (!picked.includes(hit)) picked.push(hit);
    }
    items = picked;
  } else {
    items = [...items].sort((a, b) => (b.total ?? 0) - (a.total ?? 0)).slice(0, count);
  }
  if (items.length === 0) fail("没有可生成配置的条目");

  // 4) 固定每个条目的原文快照（sha256）
  const snapshots: SnapshotInfo[] = [];
  for (const it of items) {
    const snap = await resolveSnapshot(it, snapshotDir, fetchSnapshots);
    console.log("[generate-content] 快照 " + snap.sha256.slice(0, 12) + "… ← " + it.url);
    snapshots.push(snap);
  }
  const urlToHash = new Map(snapshots.map((s) => [s.url, s.sha256]));
  const urlToItem = new Map(items.map((it) => [it.url, it]));

  // 5) 调用文本模型生成 blocks
  const provider = providerConfig();
  const system = [
    "你是每日新闻视频的内容编辑。根据给定的已核实新闻快照，生成视频 config 的 blocks 数组。",
    "每个 block 是 JSON 对象，字段：type(title|text|list|chart)、content（标题/主文案）、summary（2-4 句摘要）、",
    "facts（3-6 条事实，每条必须能在对应快照中找到依据）、points（3-5 条要点）、",
    "stats（数字卡，label/value 字符串；无数字可用 highlight 字段单条）、highlight（关键数字原样，如 \"12.3k stars\"）、",
    "narration（1-2 句口语化旁白，供 TTS）、disclaimer（一句声明）、section（仅 ai-news: ai-news|review-ai；world-news: other-news|review-other）、",
    "url（必须原样使用下方提供的来源 URL，不得拼接或发明）、sourceSnapshotHash（必须原样使用下方提供且与该 URL 配对的 hash）。",
    "开场 title block 不需要 url/sourceSnapshotHash。输出必须是单个 JSON 数组，禁止 Markdown 代码块或多余文字，",
    "禁止编造快照中不存在的事实。",
  ].join("\n");
  const user = [
    "业务日期：" + date + "，stream：" + stream + "，edition：" + edition + "。",
    "要求输出 " + items.length + " 个左右 blocks（可含一个 title 开场块，其余为内容块；内容块必须全部绑定来源）。",
    "",
    ...items.flatMap((it, i) => [
      "--- 条目 " + (i + 1) + " ---",
      "title: " + it.title,
      "source: " + it.source,
      "publishedAt: " + it.publishedAt,
      "url: " + it.url,
      "sourceSnapshotHash: " + urlToHash.get(it.url),
      "summary(已有，可参考): " + (it.summary ?? "").slice(0, 300),
      "原文快照：",
      snapshots[i].content.slice(0, 8000),
      "",
    ]),
    "只输出 JSON 数组。",
  ].join("\n");

  let parsed: GeneratedBlock[];
  try {
    const raw = await callProvider(provider, [
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    parsed = JSON.parse(extractJsonArray(raw)) as GeneratedBlock[];
  } catch (e) {
    fail("provider 失败或输出无法解析：" + (e as Error).message);
  }

  // 6) 严格校验来源绑定
  const { errors } = validateBlocks(parsed, { urlToHash, urlToItem }, stream);
  if (errors.length > 0) {
    console.error("[generate-content] 校验失败，不生成 config：");
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }

  // 7) 组装 VideoConfig
  const blocks: VideoBlock[] = parsed.map((b) => {
    const item = b.url ? urlToItem.get(b.url) : undefined;
    const section = b.section ?? (stream === "ai-news" ? "ai-news" : "other-news");
    const stats = (b.stats ?? []).map((s) => ({
      label: s.label ?? "",
      value: s.value ?? "",
      sourceUrl: b.url ?? undefined,
      sourceSnapshotHash: b.url ? urlToHash.get(b.url) : undefined,
    }));
    return {
      type: (b.type === "title" || b.type === "list" || b.type === "chart" ? b.type : "text") as VideoBlock["type"],
      content: b.content ?? "",
      summary: b.summary,
      facts: b.facts ?? [],
      points: b.points,
      stats: stats.length ? stats : undefined,
      highlight: b.highlight,
      narration: b.narration,
      source: item?.source,
      url: b.url || undefined,
      sourceSnapshotHash: b.url ? urlToHash.get(b.url) : undefined,
      disclaimer: (b.disclaimer ?? "").trim() || DEFAULT_DISCLAIMER,
      section: section as VideoBlock["section"],
    } satisfies VideoBlock;
  });

  const config: VideoConfig = {
    type: stream,
    style,
    title: get(
      "--title",
      (stream === "ai-news" ? "AI 新闻" : "世界新闻") + "日报 · " + date + " " + (edition === "morning" ? "早场" : "晚场")
    ),
    subtitle: (edition === "morning" ? "早" : "晚") + "间速览 · 每一条均有原文快照",
    engine: "hyperframes",
    template: "news-slideshow",
    chapters: [{ start: "00:00", title: (stream === "ai-news" ? "AI 新闻" : "世界新闻") + " " + edition }],
    blocks,
    workflowId: "news-daily",
    runId,
    stream,
    edition,
    cadence: "daily",
    sourceRefs: snapshots.map((s) => ({ url: s.url, sha256: s.sha256 })),
  };

  // 8) 原子写 config
  await mkdir(path.dirname(outPath), { recursive: true });
  const tmp = outPath + ".tmp";
  await writeFile(tmp, JSON.stringify(config, null, 2), "utf-8");
  await rename(tmp, outPath);

  const contentBlocks = blocks.filter((b) => b.type !== "title").length;
  console.log("[generate-content] 生成 " + blocks.length + " 块（内容 " + contentBlocks + "）→ " + path.relative(ROOT, outPath));
  console.log("[generate-content] run_id=" + runId + " 已绑定 " + snapshots.length + " 个来源快照");
  console.log("[generate-content] 下一步：node scripts/prepare-audio.ts --run-dir " + path.relative(ROOT, runDir));
}

main().catch((e) => {
  console.error("[generate-content] 失败:", e);
  process.exit(1);
});
