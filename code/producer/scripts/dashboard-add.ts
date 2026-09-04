/**
 * 内容台账登记 — 各工作流渲染完成后调用，把产物登记进预览台
 *
 * 用法：
 *   node scripts/dashboard-add.ts --type ai-news --edition morning --video out/morning/xxx.mp4 --title "今日 AI 速报"
 *   node scripts/dashboard-add.ts --type github --video out/video_short.mp4 --title "项目介绍"
 *   node scripts/dashboard-add.ts --type repost --video repost/xxx/video.mp4 --title "搬运标题" --accounts "douyin:tech01,bilibili:tech02"
 *
 * 产物：dashboard/registry.json 追加条目（status=pending）
 */
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd(); // producer/
const REGISTRY_PATH = path.join(ROOT, "dashboard", "registry.json");

interface RegistryItem {
  id: string;
  date: string;
  type: "ai-news" | "intl-news" | "cn-news" | "ent-news" | "github" | "repost";
  edition?: "morning" | "evening";
  title: string;
  videoPath: string;
  coverPath?: string;
  status: "pending" | "approved" | "drafted" | "published" | "rejected";
  scheduledFor?: string;
  targetAccounts?: string[];
  reviewReportPath?: string;
  createdAt: string;
}

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    type: (get("--type") ?? "ai-news") as RegistryItem["type"],
    edition: get("--edition") as "morning" | "evening" | undefined,
    video: get("--video") ?? "",
    cover: get("--cover"),
    title: get("--title") ?? "未命名内容",
    accounts: get("--accounts"),
    review: get("--review"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const NEWS_TYPES = ["ai-news", "intl-news", "cn-news", "ent-news"];
  if (![...NEWS_TYPES, "github", "repost"].includes(args.type)) {
    console.error("[dashboard-add] --type 必须是 ai-news|intl-news|cn-news|ent-news|github|repost");
    process.exit(1);
  }
  const videoPath = path.resolve(ROOT, args.video);
  if (!existsSync(videoPath)) {
    console.error(`[dashboard-add] 视频文件不存在：${args.video}`);
    process.exit(1);
  }
  const relVideo = path.relative(ROOT, videoPath).replace(/\\/g, "/");

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const id = `${args.type}${args.edition ? "-" + args.edition : ""}-${date}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  const item: RegistryItem = {
    id,
    date,
    type: args.type,
    title: args.title,
    videoPath: relVideo,
    status: "pending",
    createdAt: now.toISOString(),
  };
  if (args.edition && NEWS_TYPES.includes(args.type)) item.edition = args.edition;
  if (args.cover) item.coverPath = args.cover;
  if (args.accounts) item.targetAccounts = args.accounts.split(",").map((s) => s.trim()).filter(Boolean);
  if (args.review) item.reviewReportPath = args.review;

  let registry: RegistryItem[] = [];
  try {
    registry = JSON.parse(await readFile(REGISTRY_PATH, "utf-8"));
    if (!Array.isArray(registry)) registry = [];
  } catch {
    registry = [];
  }
  registry.push(item);

  await mkdir(path.dirname(REGISTRY_PATH), { recursive: true });
  const tmp = REGISTRY_PATH + ".tmp";
  await writeFile(tmp, JSON.stringify(registry, null, 2), "utf-8");
  await rename(tmp, REGISTRY_PATH);

  console.log(`[dashboard-add] ✅ 已登记：${id}`);
  console.log(`[dashboard-add] 标题：${item.title}`);
  console.log(`[dashboard-add] 视频：${relVideo}`);
  if (item.targetAccounts?.length) console.log(`[dashboard-add] 目标账号：${item.targetAccounts.join(", ")}`);
  console.log(`[dashboard-add] 打开 http://localhost:4399 审阅`);
}

main().catch((e) => {
  console.error("[dashboard-add] 失败:", e);
  process.exit(1);
});
