/**
 * 平台账号登录脚本 — 基于 social-auto-upload 的 sau_cli.py
 *
 * 原理：playwright 打开平台登录页 → 终端/本地显示二维码 → 手机扫码 →
 *       自动保存 Cookie 到 tools/social-auto-upload/cookies/{platform}_{account}.json
 *
 * 用法：
 *   npm run login -- --platform bilibili                          # 登录 B站（默认账号 creator）
 *   npm run login -- --platform douyin --headed                   # 抖音（弹出浏览器窗口，推荐）
 *   npm run login -- --platform xiaohongshu --headed              # 小红书（必须 headed）
 *   npm run login -- --platform douyin --accounts tech01,tech02 --headed  # 批量登录多账号
 *   npm run login -- --platform all --accounts a,b,c              # 全部平台 × 多账号
 *   npm run login:check -- --platform bilibili --account creator  # 检查 Cookie 有效性
 *
 * 提示：抖音/小红书对无头浏览器风控严格，扫码后可能不跳转；
 *       建议加 --headed 弹出真实浏览器窗口扫码登录。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";

const ROOT = process.cwd();
const PLATFORMS = [
  "bilibili",
  "douyin",
  "xiaohongshu",
  "kuaishou",
  "tencent",
  "weibo",
];

/** 从仓库根向上探测 tools/social-auto-upload（合并进 motion 后 SAU 在仓库根 tools/） */
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

const SAU_DIR = findSauDir();

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    platform: get("--platform") ?? "bilibili",
    account: get("--account"),
    accounts: get("--accounts"),
    check: argv.includes("--check"),
    headed: argv.includes("--headed"),
  };
}

function runSau(args: string[]) {
  const result = spawnSync("python", [path.join(SAU_DIR, "sau_cli.py"), ...args], {
    cwd: SAU_DIR,
    stdio: "inherit",
    shell: true,
  });
  return result.status === 0;
}

function main() {
  if (!existsSync(SAU_DIR)) {
    console.error(
      "[login] 未找到 social-auto-upload，请先执行：\n" +
        "  git clone https://github.com/dreammis/social-auto-upload.git tools/social-auto-upload\n" +
        "  cd tools/social-auto-upload; pip install -r requirements.txt; python -m playwright install chromium\n" +
        "  或设置 VIDO_TOOLS_DIR 指向包含 social-auto-upload 的目录"
    );
    process.exit(1);
  }

  const { platform, account, accounts, check, headed } = parseArgs(process.argv.slice(2));
  const action = check ? "check" : "login";
  const targets = platform === "all" ? PLATFORMS : [platform];
  const accountList = (accounts ?? account ?? "creator").split(",").filter(Boolean);

  for (const p of targets) {
    if (!PLATFORMS.includes(p)) {
      console.warn(`[login] 不支持的平台：${p}（支持：${PLATFORMS.join(", ")}）`);
      continue;
    }
    for (const acc of accountList) {
      console.log(`\n[login] === ${action} ${p} (account: ${acc}) ===`);
      if (check) {
        console.log("[login] 检查 Cookie 有效性…");
      } else if (headed) {
        console.log("[login] 将弹出浏览器窗口，请在窗口内扫码完成登录");
      } else {
        console.log("[login] 请用手机 APP 扫描终端/目录中出现的二维码完成登录");
        console.log("[login] 提示：抖音/小红书扫码无反应时可加 --headed 弹出浏览器窗口重试");
      }
      const extraArgs = headed && !check ? ["--headed"] : [];
      const ok = runSau([p, action, "--account", acc, ...extraArgs]);
      if (!ok) {
        console.error(`[login] ${p}(${acc}) ${action} 失败`);
        process.exit(1);
      }
      console.log(`[login] ✅ ${p}(${acc}) ${action} 完成，Cookie 已保存`);
    }
  }
}

main();
