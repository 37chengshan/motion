/**
 * 脚本运行公共库（Phase 3.5）— spawnSync 显式 utf-8，ASCII 友好
 * 新脚本统一使用；旧脚本（daily-pipeline 等）维持内联实现，逐步迁移。
 *
 * 用法：
 *   const r = runScript("scripts/foo.ts", ["--date", "2026-08-29"], { cwd: ROOT });
 *   if (!r.ok) { console.error(r.output); process.exit(1); }
 */
import { spawnSync } from "node:child_process";

export interface ScriptResult {
  ok: boolean;
  output: string;
  status: number | null;
}

export function runScript(
  script: string,
  args: string[] = [],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}
): ScriptResult {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: opts.cwd ?? process.cwd(),
    env: opts.env ?? process.env,
    encoding: "utf-8", // 显式 utf-8，规避 Windows GBK 控制台乱码
    maxBuffer: 16 * 1024 * 1024,
    timeout: opts.timeoutMs,
  });

  if (r.error) {
    return { ok: false, output: "spawn error: " + r.error.message, status: null };
  }
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  return { ok: r.status === 0, output, status: r.status };
}
