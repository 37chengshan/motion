/**
 * 多平台发布脚本 — 对接 social-auto-upload (sau_cli.py)
 *
 * 前置条件：
 *  1. 已登录各平台：npm run login -- --platform bilibili（扫码，Cookie 自动保存）
 *  2. 检查登录状态：npm run login:check -- --platform bilibili
 *
 * 平台与策略：
 *  - B站 bilibili：横屏 + 外挂字幕（biliup 上传，支持章节/标签）
 *  - 抖音 douyin：竖屏烧录字幕版，支持标签/封面/定时
 *  - 小红书 xiaohongshu：竖屏烧录字幕版
 *  - 快手 kuaishou / 视频号 tencent / 微博 weibo
 *
 * 用法：
 *   npm run publish -- --platform bilibili
 *   npm run publish -- --platform bilibili,douyin,xiaohongshu
 *   npm run publish -- --platform all
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";

const ROOT = process.cwd();
const SAU_DIR = path.resolve(ROOT, "tools", "social-auto-upload");

interface PublishTarget {
  /** sau_cli.py 平台名 */
  cliPlatform: string;
  /** 视频文件 */
  file: string;
  subtitleMode: "external-srt" | "burned-in" | "none";
}

const TARGETS: Record<string, PublishTarget> = {
  bilibili: {
    cliPlatform: "bilibili",
    file: "out/video_long.mp4",
    subtitleMode: "external-srt",
  },
  douyin: {
    cliPlatform: "douyin",
    file: "out/video_short_burned.mp4",
    subtitleMode: "burned-in",
  },
  xiaohongshu: {
    cliPlatform: "xiaohongshu",
    file: "out/video_short_burned.mp4",
    subtitleMode: "burned-in",
  },
  kuaishou: {
    cliPlatform: "kuaishou",
    file: "out/video_short_burned.mp4",
    subtitleMode: "burned-in",
  },
  tencent: {
    cliPlatform: "tencent",
    file: "out/video_long.mp4",
    subtitleMode: "none",
  },
};

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    platform: get("--platform") ?? "bilibili",
    account: get("--account") ?? "creator",
    title: get("--title"),
    tags: get("--tags") ?? "AI,开源,科技",
  };
}

function runSau(args: string[]): boolean {
  const result = spawnSync(
    "python",
    [path.join(SAU_DIR, "sau_cli.py"), ...args],
    { cwd: SAU_DIR, stdio: "inherit", shell: true }
  );
  return result.status === 0;
}

/** 发布前先检查登录状态 */
function ensureLoggedIn(cliPlatform: string, account: string): boolean {
  console.log(`[publish] 检查 ${cliPlatform} 登录状态…`);
  return runSau([cliPlatform, "check", "--account", account]);
}

async function main() {
  const { platform, account, title, tags } = parseArgs(process.argv.slice(2));

  if (!existsSync(SAU_DIR)) {
    console.error(
      "[publish] 未找到 social-auto-upload：\n" +
        "  git clone https://github.com/dreammis/social-auto-upload.git tools/social-auto-upload\n" +
        "  cd tools/social-auto-upload && pip install -r requirements.txt && python -m playwright install chromium"
    );
    process.exit(1);
  }

  const platforms =
    platform === "all" ? Object.keys(TARGETS) : platform.split(",").filter(Boolean);

  // 读取今日标题（未显式指定时）
  let videoTitle: string = title ?? "";
  if (!videoTitle) {
    try {
      const { readFile } = await import("node:fs/promises");
      const today = JSON.parse(
        await readFile(path.join(ROOT, "src", "data", "today.json"), "utf-8")
      );
      videoTitle = today.title ?? "Vido 每日视频";
    } catch {
      videoTitle = "Vido 每日视频";
    }
  }

  for (const p of platforms) {
    const target = TARGETS[p];
    if (!target) {
      console.warn(`[publish] 未知平台：${p}，跳过`);
      continue;
    }

    const videoPath = path.join(ROOT, target.file);
    if (!existsSync(videoPath)) {
      console.error(
        `[publish] 视频文件不存在：${target.file}，请先 npm run render:all`
      );
      continue;
    }

    if (!ensureLoggedIn(target.cliPlatform, account)) {
      console.error(
        `[publish] ❌ ${p} 未登录。请先运行：npm run login -- --platform ${p}`
      );
      continue;
    }

    console.log(
      `[publish] → ${p}：${target.file}（字幕：${target.subtitleMode}）`
    );
    const ok = runSau([
      target.cliPlatform,
      "upload-video",
      "--account",
      account,
      "--file",
      videoPath,
      "--title",
      videoTitle,
      "--tags",
      tags,
    ]);
    console.log(ok ? `[publish] ✅ ${p} 发布成功` : `[publish] ❌ ${p} 发布失败`);
  }
}

main().catch((e) => {
  console.error("[publish] 失败:", e);
  process.exit(1);
});
