/**
 * 账号矩阵 — 遍历 cookies 目录 + data/accounts.json，输出账号清单与有效性
 *
 * 用法：
 *   npm run accounts                # 全部账号检查（调 sau_cli check，逐个）
 *   npm run accounts -- --quick     # 只列出 cookies 与注册表，不做网络检查
 *
 * Cookie 位置：tools/social-auto-upload/cookies/{platform}_{account}.json
 */
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd(); // vido/

function findSauDir(): string {
  if (process.env.VIDO_TOOLS_DIR) {
    return path.resolve(process.env.VIDO_TOOLS_DIR, "social-auto-upload");
  }
  let dir = ROOT;
  for (let i = 0; i < 4; i++) {
    const candidate = path.resolve(dir, "tools", "social-auto-upload");
    if (existsSync(path.join(candidate, "sau_cli.py"))) return candidate;
    dir = path.resolve(dir, "..");
  }
  return path.resolve(ROOT, "tools", "social-auto-upload");
}

interface AccountEntry {
  platform: string;
  account: string;
  domains: string[];
  purpose: "creator" | "repost" | string;
  status: "active" | "paused";
  registeredAt?: string;
  notes?: string;
}

async function main() {
  const quick = process.argv.includes("--quick");
  const SAU_DIR = findSauDir();
  const cookiesDir = path.join(SAU_DIR, "cookies");

  // 1. accounts.json 注册表
  let registry: AccountEntry[] = [];
  try {
    registry = JSON.parse(await readFile(path.join(ROOT, "data", "accounts.json"), "utf-8"));
  } catch {
    /* 无注册表也允许（只有 cookies） */
  }

  // 2. cookies 目录实际登录态
  const cookieFiles: string[] = [];
  if (existsSync(cookiesDir)) {
    cookieFiles.push(...readdirSync(cookiesDir).filter((f) => f.endsWith(".json") && !f.includes("qrcode")));
  }

  const cookieSet = new Set(cookieFiles.map((f) => f.replace(".json", "")));
  const allAccounts = new Map<string, AccountEntry>();
  for (const a of registry) allAccounts.set(`${a.platform}_${a.account}`, a);
  for (const c of cookieSet) {
    if (!allAccounts.has(c)) {
      const [platform, ...rest] = c.split("_");
      allAccounts.set(c, { platform, account: rest.join("_"), domains: [], purpose: "unknown", status: "active" });
    }
  }

  console.log(`[accounts] 注册表 ${registry.length} 条 · cookies ${cookieSet.size} 个（${SAU_DIR}）\n`);
  console.log(`${"平台".padEnd(12)}${"账号".padEnd(12)}${"领域".padEnd(14)}${"用途".padEnd(10)}${"状态".padEnd(9)}Cookie`);
  console.log("-".repeat(80));

  for (const [key, a] of allAccounts) {
    const hasCookie = cookieSet.has(key);
    const paused = a.status === "paused" ? "已停用" : "正常";
    let valid = hasCookie ? "有" : "无";
    if (hasCookie && !quick) {
      const r = spawnSync("python", [path.join(SAU_DIR, "sau_cli.py"), a.platform, "check", "--account", a.account], {
        cwd: SAU_DIR,
        stdio: "pipe",
        shell: true,
        encoding: "utf-8",
      });
      const out = (r.stdout ?? "") + (r.stderr ?? "");
      valid = /valid|ok|有效|成功|true/i.test(out) ? "✓有效" : "✗失效";
    }
    console.log(
      `${a.platform.padEnd(12)}${a.account.padEnd(12)}${(a.domains ?? []).join("/").slice(0, 12).padEnd(14)}${a.purpose.padEnd(10)}${paused.padEnd(9)}${valid}`
    );
  }

  const dead = [...allAccounts.values()].filter((a) => a.status === "paused");
  if (dead.length) console.log(`\n[accounts] ⚠️ ${dead.length} 个账号已停用：${dead.map((d) => `${d.platform}/${d.account}`).join(", ")}`);
  console.log("\n[accounts] 提示：失效 Cookie 重新登录 npm run login -- --platform <平台> --account <账号> --headed");
}

main().catch((e) => {
  console.error("[accounts] 失败:", e);
  process.exit(1);
});
