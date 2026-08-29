/**
 * 四方向流标识 —— 单一真相源
 *
 * daily-research / score-and-rank / generate-content 等脚本统一从这里导入，
 * 避免各处重复定义字符串字面量导致「漏改即半迁移态」。
 *
 * 四方向（方案 A：intl-news 取代 world-news，world-news 保留为 deprecated 兼容值）
 */

export type ResearchStream =
  | "ai-news" // AI 新闻（全球 AI 动态，早晚双场）
  | "intl-news" // 国际新闻（取代原 world-news）
  | "cn-news" // 国内新闻
  | "ent-news" // 娱乐新闻（国内外）
  | "world-news" // deprecated 兼容旧值，行为同 intl-news
  | "github-daily"; // GitHub 候选（非新闻流）

/** 新闻流（不含 github-daily） */
export const NEWS_STREAMS = [
  "ai-news",
  "intl-news",
  "cn-news",
  "ent-news",
  "world-news",
] as const satisfies readonly ResearchStream[];

/** 全部合法 stream（CLI 校验用） */
export const ALL_STREAMS = [...NEWS_STREAMS, "github-daily"] as const satisfies readonly ResearchStream[];

/** NewsItem.category 兼容三值 */
export type ItemCategory = "ai" | "other" | "github";

/** stream → 中文名（标题/日志用） */
export const STREAM_LABEL: Record<ResearchStream, string> = {
  "ai-news": "AI 新闻",
  "intl-news": "国际新闻",
  "cn-news": "国内新闻",
  "ent-news": "娱乐新闻",
  "world-news": "国际新闻",
  "github-daily": "GitHub",
};

/** 类型守卫：字符串是否为合法 stream */
export function isResearchStream(s: string): s is ResearchStream {
  return (ALL_STREAMS as readonly string[]).includes(s);
}

/** stream → category（ai-news→ai，github-daily→github，其余→other） */
export function streamToCategory(stream: ResearchStream): ItemCategory {
  if (stream === "github-daily") return "github";
  if (stream === "ai-news") return "ai";
  return "other";
}

/** 是否为新闻流（非 github-daily） */
export function isNewsStream(stream: ResearchStream): boolean {
  return stream !== "github-daily";
}

/** CLI 错误提示用：允许的 stream 列表 */
export function allowedStreamsText(): string {
  return ALL_STREAMS.join("|");
}
