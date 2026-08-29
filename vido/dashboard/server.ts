/**
 * 预览台服务 — 本地内容台账审阅界面（Claude UI 风格）
 *
 * 功能：
 *  - GET  /                → dashboard/index.html
 *  - GET  /api/items       → registry.json + 增强字段（视频存在性/到期警告）
 *  - POST /api/items/:id/status  → 更新条目状态（待审/已批准/已发草稿/已发布）
 *  - GET  /media?path=...  → 流式播放 vido/ 下任意视频（支持 Range，视频可拖动）
 *
 * 到期巡检：每小时扫描 scheduledFor 距今 <7 天的草稿条目，标记 expiredSoon（动态计算，不落盘）
 *
 * 启动：npm run dashboard → http://localhost:4399
 */
import http from "node:http";
import { createReadStream } from "node:fs";
import { readFile, writeFile, stat, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.cwd(); // vido/
const PORT = 4399;
const REGISTRY_PATH = path.join(ROOT, "dashboard", "registry.json");
const INDEX_PATH = path.join(__dirname, "index.html");
const EXPIRY_WARN_DAYS = 7;
const DASHBOARD_TOKEN = process.env.PUBLISHER_DASHBOARD_TOKEN?.trim() || "";

function requireAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (!DASHBOARD_TOKEN) return true;
  const auth = req.headers.authorization || "";
  if (auth === `Bearer ${DASHBOARD_TOKEN}` || auth === DASHBOARD_TOKEN) return true;
  sendJson(res, 401, { error: "unauthorized — set Authorization: Bearer PUBLISHER_DASHBOARD_TOKEN" });
  return false;
}

export interface RegistryItem {
  id: string;
  date: string; // YYYY-MM-DD
  type: "ai-news" | "github" | "repost";
  edition?: "morning" | "evening";
  title: string;
  videoPath: string; // 相对 vido/
  coverPath?: string;
  status: "pending" | "approved" | "drafted" | "published" | "rejected";
  scheduledFor?: string; // ISO
  targetAccounts?: string[];
  reviewReportPath?: string;
  createdAt: string;
}

async function readRegistry(): Promise<RegistryItem[]> {
  try {
    const raw = await readFile(REGISTRY_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeRegistry(items: RegistryItem[]): Promise<void> {
  await mkdir(path.dirname(REGISTRY_PATH), { recursive: true });
  const tmp = REGISTRY_PATH + ".tmp";
  await writeFile(tmp, JSON.stringify(items, null, 2), "utf-8");
  await rename(tmp, REGISTRY_PATH);
}

/** 到期状态：草稿/待审条目 scheduledFor 距今 <7 天 → expiredSoon；已过 → expired */
function expiryState(item: RegistryItem): { expiredSoon: boolean; expired: boolean } {
  if (!item.scheduledFor || item.status === "published" || item.status === "rejected") {
    return { expiredSoon: false, expired: false };
  }
  const t = new Date(item.scheduledFor).getTime();
  const now = Date.now();
  return {
    expired: t < now,
    expiredSoon: t >= now && t - now < EXPIRY_WARN_DAYS * 24 * 3600 * 1000,
  };
}

async function enhance(items: RegistryItem[]) {
  return Promise.all(
    items.map(async (item) => {
      const full = path.resolve(ROOT, item.videoPath);
      const exists = full.startsWith(ROOT) && existsSync(full);
      // 审查报告摘要（reviewReportPath 指向 review-video.ts 的输出）
      let review: Record<string, unknown> | null = null;
      if (item.reviewReportPath) {
        const rp = path.resolve(ROOT, item.reviewReportPath);
        if (rp.startsWith(ROOT) && existsSync(rp)) {
          try {
            const raw = JSON.parse(await readFile(rp, "utf-8"));
            review = {
              verdict: raw.verdict,
              summary: raw.summary,
              copyrightRisk: raw.copyrightRisk,
              issueCount: Array.isArray(raw.issues) ? raw.issues.length : 0,
              issues: Array.isArray(raw.issues) ? raw.issues.slice(0, 5).map((i: any) => ({
                timestampSec: i.timestampSec,
                severity: i.severity,
                description: i.description,
              })) : [],
            };
          } catch {
            /* 报告损坏时忽略 */
          }
        }
      }
      return { ...item, videoExists: exists, review, ...expiryState(item) };
    })
  );
}

function sendJson(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const VIDEO_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

/** 流式媒体（支持 Range，浏览器可拖动进度） */
function serveMedia(res: http.ServerResponse, rawPath: string) {
  const decoded = decodeURIComponent(rawPath);
  const full = path.resolve(ROOT, decoded);
  if (!full.startsWith(ROOT)) {
    sendJson(res, 400, { error: "path outside root" });
    return;
  }
  if (!existsSync(full)) {
    sendJson(res, 404, { error: "media not found" });
    return;
  }
  const type = VIDEO_TYPES[path.extname(full).toLowerCase()] ?? "application/octet-stream";
  void stat(full).then((s) => {
    const total = s.size;
    const range = res.req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
      if (isNaN(start) || start >= total) {
        res.writeHead(416, { "Content-Range": `bytes */${total}` });
        res.end();
        return;
      }
      end = Math.min(end, total - 1);
      res.writeHead(206, {
        "Content-Type": type,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${total}`,
      });
      createReadStream(full, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": total });
      createReadStream(full).pipe(res);
    }
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const p = url.pathname;

  try {
    if (p === "/" || p === "/index.html") {
      const html = await readFile(INDEX_PATH, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (p === "/api/items" && req.method === "GET") {
      const items = await readRegistry();
      sendJson(res, 200, await enhance(items));
      return;
    }

    if (p === "/api/items" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      const body = JSON.parse((await readBody(req)) || "{}");
      const id = body.id;
      const status = body.status;
      if (!id || !status) {
        sendJson(res, 400, { error: "id and status required" });
        return;
      }
      const items = await readRegistry();
      const item = items.find((i) => i.id === id);
      if (!item) {
        sendJson(res, 404, { error: "item not found" });
        return;
      }
      item.status = status;
      if (status === "drafted" && body.scheduledFor) item.scheduledFor = body.scheduledFor;
      await writeRegistry(items);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (p.startsWith("/api/items/") && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      const id = p.split("/")[3];
      const body = JSON.parse((await readBody(req)) || "{}");
      const items = await readRegistry();
      const item = items.find((i) => i.id === id);
      if (!item) {
        sendJson(res, 404, { error: "item not found" });
        return;
      }
      item.status = body.status ?? item.status;
      if (body.scheduledFor) item.scheduledFor = body.scheduledFor;
      await writeRegistry(items);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (p === "/media") {
      const rawPath = url.searchParams.get("path") ?? "";
      if (!rawPath) {
        sendJson(res, 400, { error: "path required" });
        return;
      }
      serveMedia(res, rawPath);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
  } catch (e) {
    sendJson(res, 500, { error: String(e) });
  }
});

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

/** 到期巡检日志（每小时） */
setInterval(async () => {
  try {
    const items = await readRegistry();
    const soon = items.filter((i) => expiryState(i).expiredSoon);
    if (soon.length) {
      console.log(`[dashboard] ⚠️ ${soon.length} 条草稿将在 7 天内到期，请尽快审阅发布或删除`);
    }
  } catch {
    /* ignore */
  }
}, 3600 * 1000).unref();

server.listen(PORT, () => {
  console.log(`[dashboard] 预览台已启动 → http://localhost:${PORT}`);
  console.log(`[dashboard] 台账：${REGISTRY_PATH}`);
});