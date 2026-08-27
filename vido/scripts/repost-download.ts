/**
 * 搬运采集层 — 无 AI 全自动，Windows 任务计划程序每 2 小时触发（08:00-22:00）
 *
 * 流程：
 *  1. 读 repost/config.json（flclash 代理端口、时长/清晰度上限）
 *  2. 读 repost/sources.json（领域 → YouTube 频道 / B站 UP 主）
 *  3. 每源 yt-dlp --flat-playlist 列出近 3 天候选 → 按 repost/history.json 去重 → 每源取 2 条
 *  4. 逐条下载到 repost/inbox/<videoId>/（视频 + srt 字幕 + 缩略图 + info.json）
 *  5. 写入 history.json（status=inbox）
 *  6. 磁盘配额：已处理（processed/rejected）>14 天的本地视频删除，只留 meta.json
 *
 * 幂等：已入 inbox 的 videoId 不会重复下载；漏跑由下轮补齐。
 *
 * 用法：node scripts/repost-download.ts [--dry-run] [--limit N]
 */
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd(); // vido/
const REPOST_DIR = path.join(ROOT, "repost");

interface RepostConfig {
  proxy: { host: string; port: number; note?: string };
  limits: {
    maxDurationSec: number;
    maxHeight: number;
    maxPerSource: number;
    maxPerRound: number;
    recentDays: number;
  };
  archiveDays: number;
  historyPath: string;
  inboxDir: string;
}

interface RepostSource {
  domain: string;
  name: string;
  platform: "youtube" | "bilibili";
  url: string;
}

interface HistoryEntry {
  videoId: string;
  url: string;
  source: string;
  domain: string;
  title: string;
  downloadedAt: string;
  status: "inbox" | "processed" | "rejected";
  publishedAt?: string;
  published?: boolean;
}

function run(cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    encoding: "utf-8",
    env: { ...process.env, ...opts.env },
    // 不用 shell:true：cmd.exe 会把 %(id)s 等模板中的 % 当环境变量展开导致失败
    shell: false,
    timeout: 20 * 60 * 1000, // 单条下载超时 20 分钟
  });
  if (r.error) {
    return { ok: false, stdout: "", stderr: String(r.error.message ?? r.error) };
  }
  return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

async function readJson<T>(p: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(p, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function ytDlpCmd(): string {
  // 优先 PATH 中的 yt-dlp，其次 python -m yt_dlp
  const probe = run("yt-dlp", ["--version"]);
  return probe.ok ? "yt-dlp" : "python";
}

function ytDlpArgs(useModule: boolean, ...args: string[]): string[] {
  return useModule ? ["-m", "yt_dlp", ...args] : args;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const limitFlag = process.argv.indexOf("--limit");
  const limit = limitFlag >= 0 ? parseInt(process.argv[limitFlag + 1] ?? "0", 10) : 0;

  const config = await readJson<RepostConfig>(path.join(REPOST_DIR, "config.json"), {
    proxy: { host: "127.0.0.1", port: 7890 },
    limits: { maxDurationSec: 900, maxHeight: 1080, maxPerSource: 2, maxPerRound: 10, recentDays: 3 },
    archiveDays: 14,
    historyPath: "repost/history.json",
    inboxDir: "repost/inbox",
  });
  const sources = (await readJson<{ sources: RepostSource[] }>(path.join(REPOST_DIR, "sources.json"), { sources: [] })).sources;
  const history = await readJson<HistoryEntry[]>(path.resolve(ROOT, config.historyPath), []);
  const inboxDir = path.resolve(ROOT, config.inboxDir);
  const L = config.limits;
  const proxyUrl = `http://${config.proxy.host}:${config.proxy.port}`;
  const ytCmd = ytDlpCmd();
  const useModule = ytCmd === "python";

  if (ytCmd === "python") {
    const probe = run("python", ["-c", "import yt_dlp; print('ok')"]);
    if (!probe.ok) {
      console.error("[repost] 未找到 yt-dlp：请安装（pip install yt-dlp）或加入 PATH");
      process.exit(1);
    }
  }

  console.log(`[repost] 采集开始：${sources.length} 个源，代理 ${proxyUrl}，${dryRun ? "DRY-RUN（不下载）" : ""}`);
  const historyIds = new Set(history.map((h) => h.videoId));
  const done: string[] = [];
  let roundCount = 0;

  for (const src of sources) {
    if (limit > 0 && roundCount >= limit) break;
    console.log(`\n[repost] ── 源：${src.name}（领域：${src.domain} / ${src.platform}）──`);

    // 1. flat-playlist 列出候选（只取元数据，不下载；--ignore-config 防用户环境配置干扰）
    const list = run(
      ytCmd,
      [
        ...ytDlpArgs(useModule),
        "--ignore-config",
        "--flat-playlist",
        "--playlist-end", "30",
        "--dateafter", `now-${L.recentDays}days`,
        "--print", "%(id)s | %(title)s | %(duration)s",
        "--proxy", proxyUrl,
        src.url,
      ],
      { env: { HTTPS_PROXY: proxyUrl, HTTP_PROXY: proxyUrl } }
    );
    if (!list.ok) {
      console.warn(`[repost] ${src.name} 列表失败（跳过）: ${list.stderr.slice(0, 200)}`);
      continue;
    }

    const candidates = list.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(" | ");
        const id = (parts[0] ?? "").trim();
        const duration = parseInt((parts[parts.length - 1] ?? "0").trim(), 10);
        const title = parts.slice(1, -1).join(" | ").slice(0, 200);
        return { id, title, duration: isNaN(duration) ? 0 : duration };
      })
      .filter((c) => c.id && !historyIds.has(c.id) && c.duration <= L.maxDurationSec)
      .slice(0, L.maxPerSource);

    if (!candidates.length) {
      console.log(`[repost] ${src.name}：无新候选（近 ${L.recentDays} 天内无符合条件或已入历史）`);
      continue;
    }

    for (const c of candidates) {
      if (limit > 0 && roundCount >= limit) break;
      const dstDir = path.join(inboxDir, c.id);
      if (existsSync(dstDir)) {
        console.log(`[repost] ${c.id} 目录已存在，跳过`);
        continue;
      }

      if (dryRun) {
        console.log(`[repost] [dry-run] 将下载 ${c.id} — ${c.title.slice(0, 60)}`);
        done.push(c.id);
        roundCount++;
        continue;
      }

      console.log(`[repost] 下载 ${c.id} — ${c.title.slice(0, 60)}`);
      const dl = run(
        ytCmd,
        [
          ...ytDlpArgs(useModule),
          "--ignore-config",
          "-f", `bv*[height<=${L.maxHeight}]+ba/b[height<=${L.maxHeight}]`,
          "--write-subs", "--convert-subs", "srt", "--write-thumbnail", "--write-info-json",
          "--proxy", proxyUrl,
          "-o", path.join(dstDir, "%(id)s.%(ext)s"),
          c.id.startsWith("http") ? c.id : `https://www.youtube.com/watch?v=${c.id}`,
        ],
        { env: { HTTPS_PROXY: proxyUrl, HTTP_PROXY: proxyUrl } }
      );
      if (!dl.ok) {
        console.warn(`[repost] ${c.id} 下载失败：${dl.stderr.slice(0, 300)}`);
        continue;
      }

      // info.json 提取发布时间
      let publishedAt: string | undefined;
      const infoPath = path.join(dstDir, `${c.id}.info.json`);
      if (existsSync(infoPath)) {
        try {
          const info = JSON.parse(await readFile(infoPath, "utf-8"));
          publishedAt = info.upload_date ? `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6, 8)}` : undefined;
        } catch {
          /* ignore */
        }
      }

      history.push({
        videoId: c.id,
        url: `https://www.youtube.com/watch?v=${c.id}`,
        source: src.name,
        domain: src.domain,
        title: c.title,
        downloadedAt: new Date().toISOString(),
        status: "inbox",
        publishedAt,
      });
      done.push(c.id);
      roundCount++;
      console.log(`[repost] ✅ ${c.id} → repost/inbox/${c.id}/（${history.length} 条历史）`);
    }
  }

  // 历史持久化
  await mkdir(REPOST_DIR, { recursive: true });
  await writeFile(path.resolve(ROOT, config.historyPath), JSON.stringify(history, null, 2), "utf-8");

  // 磁盘配额：已处理 >14 天删除本地视频（保留 meta.json 与 info.json）
  let freed = 0;
  for (const dir of existsSync(inboxDir) ? readdirSync(inboxDir) : []) {
    const entry = history.find((h) => h.videoId === dir);
    if (!entry || entry.status === "inbox") continue;
    const ageDays = (Date.now() - new Date(entry.downloadedAt).getTime()) / 86400_000;
    if (ageDays <= config.archiveDays) continue;
    const dirPath = path.join(inboxDir, dir);
    for (const f of existsSync(dirPath) ? readdirSync(dirPath) : []) {
      if (f === "meta.json" || f.endsWith(".info.json")) continue;
      await rm(path.join(dirPath, f), { force: true });
      freed++;
    }
    console.log(`[repost] 清理 ${dir}（已 ${Math.round(ageDays)} 天，保留 meta/info）`);
  }

  console.log(`\n[repost] 完成：新增 ${done.length} 条${dryRun ? "（dry-run 未落盘）" : ""}，清理 ${freed} 个文件，历史共 ${history.length} 条`);
  if (done.length) console.log(`[repost] inbox 待加工：${done.join(", ")}`);
  console.log("[repost] 下一步：AI 加工层（vido-repost skill）巡检 inbox → 包装 → 草稿上传");
}

main().catch((e) => {
  console.error("[repost] 失败:", e);
  process.exit(1);
});
