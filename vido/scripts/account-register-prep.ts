/**
 * 账号注册准备 — 批量注册的人工前置环节（注册本身必须人工，本脚本做目录与台账准备）
 *
 * 为每个新账号：
 *  1. 创建独立 Chrome profile 目录 tools/profiles/{platform}_{account}（注册/登录用，指纹隔离）
 *  2. 生成注册信息核对单（手机号/邮箱/实名/养号计划——只做清单，不生成虚假身份）
 *  3. data/accounts.json 追加条目（purpose=repost, status=paused 待养号）
 *
 * 用法：
 *   node scripts/account-register-prep.ts --platform douyin --account tech01 --domain 数码
 *   node scripts/account-register-prep.ts --platform xiaohongshu --account travel02 --domain 旅行 --phone 尾号1234
 *
 * 风控基线：单日单 IP 注册 ≤2 个；新号先手动使用 3-7 天（养号）再接自动化。
 */
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd(); // vido/
const ACCOUNTS_PATH = path.join(ROOT, "data", "accounts.json");
const PROFILES_DIR = path.join(ROOT, "tools", "profiles");
const CHECKLIST_DIR = path.join(ROOT, "data", "register-checklists");

interface AccountEntry {
  platform: string;
  account: string;
  domains: string[];
  purpose: "creator" | "repost";
  status: "active" | "paused";
  registeredAt?: string;
  notes?: string;
  phoneTail?: string;
}

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    platform: get("--platform") ?? "",
    account: get("--account") ?? "",
    domain: get("--domain") ?? "",
    phone: get("--phone"),
    email: get("--email"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.platform || !args.account) {
    console.error("用法：node scripts/account-register-prep.ts --platform <平台> --account <账号名> [--domain 领域] [--phone 尾号] [--email 邮箱]");
    process.exit(1);
  }

  const key = `${args.platform}_${args.account}`;
  const profileDir = path.join(PROFILES_DIR, key);
  if (existsSync(profileDir)) {
    console.warn(`[register-prep] profile 已存在：${profileDir}`);
  } else {
    await mkdir(profileDir, { recursive: true });
    console.log(`[register-prep] 已创建独立 profile：${profileDir}`);
    console.log(`[register-prep]   注册/登录浏览器命令：chrome --user-data-dir=${profileDir}`);
  }

  // 注册信息核对单
  const today = new Date().toISOString().slice(0, 10);
  const checklist = [
    "# 注册信息核对单",
    "",
    `- 平台：${args.platform}`,
    `- 账号名：${args.account}`,
    `- 领域：${args.domain || "（待定）"}`,
    `- 手机号：${args.phone || "（待填，需独立手机号）"}`,
    `- 邮箱：${args.email || "（待填，独立邮箱）"}`,
    "- 实名认证：抖音/小红书/B站/快手均需实名，确认一人实名数量上限",
    "- 注册节奏：单日单 IP ≤2 个",
    "- 养号计划：注册后手动使用 3-7 天（浏览/点赞/收藏），再接入自动化",
    "- 注册完成后：npm run login -- --platform " + args.platform + " --account " + args.account + " --headed",
    "",
    `（生成时间 ${new Date().toISOString()}，仅作清单，不涉及任何身份信息生成）`,
  ].join("\n");
  await mkdir(CHECKLIST_DIR, { recursive: true });
  const checklistPath = path.join(CHECKLIST_DIR, `${key}.md`);
  await writeFile(checklistPath, checklist, "utf-8");
  console.log(`[register-prep] 核对单：${checklistPath}`);

  // 台账追加（paused 待养号）
  let registry: AccountEntry[] = [];
  try {
    registry = JSON.parse(await readFile(ACCOUNTS_PATH, "utf-8"));
    if (!Array.isArray(registry)) registry = [];
  } catch {
    registry = [];
  }
  if (registry.some((a) => a.platform === args.platform && a.account === args.account)) {
    console.warn(`[register-prep] accounts.json 已有 ${key}，跳过台账写入`);
    return;
  }
  registry.push({
    platform: args.platform,
    account: args.account,
    domains: args.domain ? [args.domain] : [],
    purpose: "repost",
    status: "paused",
    registeredAt: today,
    phoneTail: args.phone,
    notes: "新号，待人工注册 + 养号 3-7 天后改 status=active",
  });
  const tmp = ACCOUNTS_PATH + ".tmp";
  await writeFile(tmp, JSON.stringify(registry, null, 2), "utf-8");
  await rename(tmp, ACCOUNTS_PATH);
  console.log(`[register-prep] ✅ 已登记到 accounts.json（status=paused）：${key}`);
  console.log("[register-prep] 下一步：按核对单人工注册 → 养号 → npm run login 采集 Cookie");
}

main().catch((e) => {
  console.error("[register-prep] 失败:", e);
  process.exit(1);
});
