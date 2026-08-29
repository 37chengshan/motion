/**
 * CLI 参数解析公共库（Phase 3.5）
 * 新脚本统一使用；旧脚本（daily-research 等）维持内联实现，逐步迁移。
 *
 * 用法：
 *   const args = parseArgs(process.argv.slice(2));
 *   args.get("--date"); args.get("--count", "3"); args.has("--content");
 */
export interface ParsedArgs {
  /** 取参数值；不存在返回 fallback */
  get(flag: string, fallback?: string): string;
  /** 布尔开关是否存在 */
  has(flag: string): boolean;
  /** 原始参数列表 */
  raw: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const raw = [...argv];
  return {
    get(flag, fallback = "") {
      const i = raw.indexOf(flag);
      return i >= 0 && raw[i + 1] ? raw[i + 1] : fallback;
    },
    has(flag) {
      return raw.includes(flag);
    },
    raw,
  };
}
