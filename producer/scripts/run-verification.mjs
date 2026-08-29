#!/usr/bin/env node
/**
 * 验证入口（Phase 0.3）— node 直跑，避开 bash/WSL 与 PowerShell 编码坑
 *
 * 用法（producer/ 下）：
 *   node scripts/run-verification.mjs
 *   npm run verify
 *
 * 检查项：
 *   1. tsc --noEmit        类型检查（必须为 0 错误）
 *   2. node --test         单元测试（scripts/ 下 *.test.ts；无测试文件时 SKIP）
 *
 * 约定：
 *   - 输出全 ASCII 标记（[PASS]/[FAIL]/[SKIP]），避免 Windows GBK 控制台乱码
 *   - 任一检查失败 → 退出码 1
 *   - 子进程统一 encoding utf-8
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSC_BIN = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");
const SCRIPTS_DIR = path.join(ROOT, "scripts");

/** 递归查找 scripts/ 下的 *.test.ts / *.test.mjs */
function findTestFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findTestFiles(full, acc);
    } else if (/\.test\.(ts|mjs|js)$/.test(entry.name)) {
      acc.push(path.relative(ROOT, full).replace(/\\/g, "/"));
    }
  }
  return acc;
}

/** 跑一个检查；返回是否通过 */
function runCheck(label, cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf-8",
    maxBuffer: 16 * 1024 * 1024,
  });

  if (r.error) {
    console.log(`[FAIL] ${label}`);
    console.log(`       spawn error: ${r.error.message}`);
    return false;
  }

  const ok = r.status === 0;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}`);

  if (!ok) {
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    if (out) {
      for (const line of out.split("\n").slice(0, 40)) {
        console.log(`       ${line}`);
      }
    }
  }
  return ok;
}

const results = [];

// ── 1. TypeScript 类型检查 ──
if (existsSync(TSC_BIN)) {
  results.push(
    runCheck("tsc --noEmit", process.execPath, [TSC_BIN, "--noEmit"])
  );
} else {
  console.log("[SKIP] tsc --noEmit (typescript not installed)");
}

// ── 2. 单元测试 ──
const testFiles = findTestFiles(SCRIPTS_DIR);
if (testFiles.length > 0) {
  results.push(
    runCheck(`node --test (${testFiles.length} files)`, process.execPath, [
      "--test",
      ...testFiles,
    ])
  );
} else {
  console.log("[SKIP] node --test (no test files under scripts/)");
}

// ── 汇总 ──
const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log("");
console.log(`=== verification: ${passed}/${results.length} passed ===`);

if (failed > 0) {
  process.exit(1);
}
console.log("[OK] all checks passed");
