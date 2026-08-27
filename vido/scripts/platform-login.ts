/**
 * 平台账号登录脚本 — 基于 social-auto-upload 的 sau_cli.py
 *
 * 原理：playwright 打开平台登录页 → 终端/本地显示二维码 → 手机扫码 →
 *       自动保存 Cookie 到 tools/social-auto-upload/db/ 目录
 *
 * 用法：
 *   npm run login -- --platform bilibili            # 登录 B站
 *   npm run login -- --platform douyin              # 登录抖音（无头模式）
 *   npm run login -- --platform douyin --headed     # 登录抖音（弹出浏览器窗口，推荐）
 *   npm run login -- --platform xiaohongshu --headed# 登录小红书（弹出浏览器窗口，推荐）
 *   npm run login -- --platform kuaishou            # 登录快手
 *   npm run login -- --platform tencent             # 登录视频号
 *   npm run login -- --platform weibo               # 登录微博
 *   npm run login:check -- --platform bilibili      # 检查 Cookie 是否有效
 *   npm run login -- --platform all                 # 逐个登录全部平台
 *
 * 账号名默认 creator（可加 --account 自定义多账号）
 *
 * 提示：抖音/小红书对无头浏览器风控严格，扫码后可能不跳转；
 *       建议加 --headed 弹出真实浏览器窗口扫码登录。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";

const SAU_DIR = path.resolve(process.cwd(), "tools", "social-auto-upload");
const PLATFORMS = [
  "bilibili",
  "douyin",
  "xiaohongshu",
  "kuaishou",
  "tencent",
  "weibo",
];

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    platform: get("--platform") ?? "bilibili",
    account: get("--account") ?? "creator",
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
        "  cd tools/social-auto-upload; pip install -r requirements.txt; python -m playwright install chromium"
    );
    process.exit(1);
  }

  const { platform, account, check, headed } = parseArgs(process.argv.slice(2));
  const action = check ? "check" : "login";
  const targets = platform === "all" ? PLATFORMS : [platform];

  for (const p of targets) {
    if (!PLATFORMS.includes(p)) {
      console.warn(`[login] 不支持的平台：${p}（支持：${PLATFORMS.join(", ")}）`);
      continue;
    }
    console.log(`\n[login] === ${action} ${p} (account: ${account}) ===`);
    if (check) {
      console.log("[login] 检查 Cookie 有效性…");
    } else if (headed) {
      console.log("[login] 将弹出浏览器窗口，请在窗口内扫码完成登录");
    } else {
      console.log("[login] 请用手机 APP 扫描终端/目录中出现的二维码完成登录");
      console.log("[login] 提示：抖音/小红书扫码无反应时可加 --headed 弹出浏览器窗口重试");
    }
    const extraArgs = headed && !check ? ["--headed"] : [];
    const ok = runSau([p, action, "--account", account, ...extraArgs]);
    if (!ok) {
      console.error(`[login] ${p} ${action} 失败`);
      process.exit(1);
    }
    console.log(`[login] ✅ ${p} ${action} 完成，Cookie 已保存`);
  }
}

main();
