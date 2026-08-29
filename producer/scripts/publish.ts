/**
 * 多平台发布脚本 — 对接 social-auto-upload (sau_cli.py)
 *
 * 草稿闸口（默认开启）：--draft-mode 下所有平台停在草稿态
 *  - tencent（视频号）：真草稿（sau --draft）
 *  - 其他平台：远期定时（now + 平台安全上限 DRAFT_HORIZON），到期前由人工在后台改"立即发布"
 *  - 显式 --schedule 覆盖自动时间；--no-draft-mode 立即发布
 *
 * 前置条件：
 *  1. 已登录各平台：npm run login -- --platform bilibili（扫码，Cookie 自动保存）
 *  2. 检查登录状态：npm run login:check -- --platform bilibili
 *
 * 用法：
 *   npm run publish -- --platform bilibili
 *   npm run publish -- --platform bilibili,douyin,xiaohongshu
 *   npm run publish -- --platform all
 *   npm run publish -- --platform douyin --account tech01,tech02 --meta repost/xxx/meta.json
 *   npm run publish -- --platform douyin --no-draft-mode
 *   npm run publish -- --platform douyin --schedule "2026-09-01 10:00"
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

const ROOT = process.cwd();

/** 平台定时安全上限（天）：sau --schedule 只接受 %Y-%m-%d %H:%M；null = 用真 --draft */
const DRAFT_HORIZON_DAYS: Record<string, number | null> = {
  bilibili: 25,
  douyin: 9,
  xiaohongshu: 13,
  kuaishou: 6,
  tencent: null,
};

interface PublishTarget {
  cliPlatform: string;
  file: string;
  subtitleMode: "external-srt" | "burned-in" | "none";
  defaultTid?: number; // bilibili 分区
}

const TARGETS: Record<string, PublishTarget> = {
  bilibili: {
    cliPlatform: "bilibili",
    file: "out/video_long.mp4",
    subtitleMode: "external-srt",
    defaultTid: 122, // 数码
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

interface MetaFile {
  title?: string;
  tags?: string[];
  desc?: string;
  declaration?: string;
  cover?: string;
  sourceUrl?: string;
  author?: string;
}

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (flag: string) => argv.includes(flag);
  return {
    platform: get("--platform") ?? "bilibili",
    account: get("--account") ?? "creator",
    title: get("--title"),
    tags: get("--tags"),
    desc: get("--desc"),
    tid: get("--tid"),
    meta: get("--meta"),
    declaration: get("--declaration"),
    schedule: get("--schedule"),
    draftMode: !has("--no-draft-mode") && !has("--publish-now"),
    thumbnail: get("--thumbnail"),
  };
}

function loadMeta(metaPath?: string): MetaFile {
  if (!metaPath) return {};
  try {
    return JSON.parse(readFileSync(path.resolve(ROOT, metaPath), "utf-8")) as MetaFile;
  } catch (e) {
    console.warn(`[publish] 读取 --meta 失败（${metaPath}），忽略：`, e);
    return {};
  }
}

/** now + horizonDays，格式 %Y-%m-%d %H:%M */
function formatSchedule(base: Date, horizonDays: number): string {
  const d = new Date(base.getTime() + horizonDays * 24 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function runSau(args: string[]): { ok: boolean; status: number | null } {
  const result = spawnSync(
    "python",
    [path.join(SAU_DIR, "sau_cli.py"), ...args],
    { cwd: SAU_DIR, stdio: "inherit", shell: true }
  );
  return { ok: result.status === 0, status: result.status };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 发布前先检查登录状态 */
function ensureLoggedIn(cliPlatform: string, account: string): boolean {
  console.log(`[publish] 检查 ${cliPlatform}(${account}) 登录状态…`);
  return runSau([cliPlatform, "check", "--account", account]).ok;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const meta = loadMeta(args.meta);

  const platforms = args.platform === "all" ? Object.keys(TARGETS) : args.platform.split(",").filter(Boolean);
  const accounts = args.account.split(",").filter(Boolean);

  // 标题/标签/描述解析优先级：CLI > meta.json > today.json
  let videoTitle = args.title ?? meta.title ?? "";
  let tags = args.tags ?? (meta.tags ? meta.tags.join(",") : "");
  let desc = args.desc ?? meta.desc ?? "";
  const declaration = args.declaration ?? meta.declaration;
  if (!tags) tags = "AI,开源,科技";
  if (!videoTitle || !desc) {
    try {
      const today = JSON.parse(readFileSync(path.join(ROOT, "src", "data", "today.json"), "utf-8"));
      if (!videoTitle) videoTitle = today.title ?? "Vido 每日视频";
      if (!desc) desc = today.title ?? videoTitle;
    } catch {
      if (!videoTitle) videoTitle = "Vido 每日视频";
      if (!desc) desc = videoTitle;
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
      console.error(`[publish] 视频文件不存在：${target.file}，请先渲染`);
      continue;
    }

    const scheduleArg = args.schedule ?? (args.draftMode ? formatSchedule(new Date(), DRAFT_HORIZON_DAYS[p] ?? 9) : undefined);

    for (const account of accounts) {
      if (!ensureLoggedIn(target.cliPlatform, account)) {
        console.error(`[publish] ❌ ${p}(${account}) 未登录。请先运行：npm run login -- --platform ${p} --account ${account}`);
        continue;
      }

      const baseArgs = [
        target.cliPlatform,
        "upload-video",
        "--account", account,
        "--file", videoPath,
        "--title", videoTitle,
        "--tags", tags,
      ];
      if (desc) baseArgs.push("--desc", desc);
      if (p === "bilibili") baseArgs.push("--tid", args.tid ?? String(target.defaultTid ?? 122));
      if (declaration && p === "douyin") baseArgs.push("--declaration", declaration);
      if (args.thumbnail) baseArgs.push("--thumbnail", path.resolve(ROOT, args.thumbnail));

      const draftNote = p === "tencent" ? "真草稿箱（--draft）" : `定时 ${scheduleArg}`;
      if (p === "tencent" && args.draftMode && !args.schedule) {
        baseArgs.push("--draft");
      } else if (scheduleArg) {
        baseArgs.push("--schedule", scheduleArg);
      }

      console.log(`[publish] → ${p}(${account})：${target.file}（字幕：${target.subtitleMode}，${args.draftMode ? "草稿闸口 " + draftNote : "立即发布"}）`);
      let result = runSau(baseArgs);

      // bilibili 远期定时被拒 → 回退近期待发并告警
      if (!result.ok && p === "bilibili" && scheduleArg && args.draftMode) {
        const fallback = formatSchedule(new Date(Date.now() + 2 * 3600 * 1000), 0);
        console.warn(`[publish] ⚠️ ${p} 远期定时失败，回退为近期待发（${fallback}）`);
        const retryArgs = baseArgs.filter((a) => a !== scheduleArg);
        result = runSau([...retryArgs, "--schedule", fallback]);
      }

      console.log(result.ok ? `[publish] ✅ ${p}(${account}) 已上传（${args.draftMode ? "草稿/定时待人工审阅" : "已发布"}）` : `[publish] ❌ ${p}(${account}) 上传失败`);
      if (result.ok && accounts.length > 1) {
        const jitter = 5 * 60 * 1000 + Math.random() * 10 * 60 * 1000; // 5-15 分钟随机抖动
        console.log(`[publish] 账号间隔抖动 ${Math.round(jitter / 1000)}s 后继续…`);
        await sleep(jitter);
      }
    }
  }
}

const SAU_DIR = findSauDir();
if (!existsSync(path.join(SAU_DIR, "sau_cli.py"))) {
  console.error(
    "[publish] 未找到 social-auto-upload：\n" +
      "  git clone https://github.com/dreammis/social-auto-upload.git tools/social-auto-upload\n" +
      "  cd tools/social-auto-upload && pip install -r requirements.txt && python -m playwright install chromium\n" +
      "  或设置 VIDO_TOOLS_DIR 指向包含 social-auto-upload 的目录"
  );
  process.exit(1);
}

main().catch((e) => {
  console.error("[publish] 失败:", e);
  process.exit(1);
});
