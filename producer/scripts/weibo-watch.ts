/**
 * 微博官方账号采集（cn-news）— 走专用浏览器 CDP(9223)，移动版免登录
 *
 * handle 三种格式的 URL 策略：
 *   纯数字 UID → m.weibo.cn/u/<uid>
 *   中文名     → m.weibo.cn/n/<中文>（页面 302 到 /u/<uid>）
 *   英文 ID    → m.weibo.cn API 搜索（containerid=100103type=1&q=<id>）解析 UID → /u/<uid>
 *
 * 用法（producer/ 下）：
 *   node scripts/weibo-watch.ts --date 2026-08-30 --stream cn-news
 *   node scripts/weibo-watch.ts --date 2026-08-30 --handles rmrb,人民日报 --limit 3
 *
 * 输出：runs/<date>/<stream>/research/weibo-watch.json（items 与 raw.json 同构，
 *       official=true 在 score-and-rank 中按最高可信源参与选题）
 * 前置：专用浏览器 9223 运行中（无需微博登录，移动版公开可见）
 */
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { markStageDone } from "./stage.ts";

const ROOT = process.cwd();
const CDP_PORT = Number(process.env.X_CDP_PORT ?? "9223");
const UID_CACHE = path.join(ROOT, "config", "weibo-uid-cache.json");

interface WeiboAccount {
  name: string;
  handle: string;
  org?: string;
  official?: boolean;
}

interface WeiboItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  category: "other";
  official: boolean;
  handle: string;
  org?: string;
}

// ───────────── CDP 客户端 ─────────────

function connect(wsUrl: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error("ws connect failed"));
  });
}
let msgId = 0;
function cdp(ws: WebSocket, method: string, params: Record<string, unknown> = {}): Promise<any> {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    const onMsg = (ev: MessageEvent) => {
      const msg = JSON.parse(ev.data as string);
      if (msg.id === id) {
        ws.removeEventListener("message", onMsg);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 移动版微博正文提取（时间 + 正文 + 链接；按正文签名去重，避免 .card-wrap/.card 嵌套重复） */
const EXTRACT_JS = `(() => {
  const out = [];
  const seen = new Set();
  for (const card of document.querySelectorAll('.card-wrap')) {
    const textEl = card.querySelector('.weibo-text, .txt');
    const text = textEl ? textEl.innerText.trim() : '';
    const timeEl = card.querySelector('.time, .from a');
    const time = timeEl ? timeEl.innerText.trim() : '';
    if (!text || text.length < 10) continue;
    const sig = text.slice(0, 50);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ text: text.slice(0, 200), time });
  }
  return out.slice(0, 15);
})()`;

/** 从最终 URL 提取 UID */
const FINAL_URL_JS = `location.href`;

/** 英文 ID → UID：浏览器内 fetch 搜索 API 解析 */
const SEARCH_UID_JS = (handle: string) => `(async () => {
  try {
    const r = await fetch('https://m.weibo.cn/api/container/getIndex?containerid=100103type%3D1%26q%3D' + encodeURIComponent('${handle}'), { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const j = await r.json();
    const cards = (j.data && j.data.cards) || [];
    for (const c of cards) {
      if (c.card_type === 11 && c.user && c.user.id) {
        return { uid: String(c.user.id), screen_name: c.user.screen_name, followers: c.user.followers_count || 0 };
      }
    }
    return { uid: null, error: 'no user card' };
  } catch (e) { return { uid: null, error: String(e) }; }
})()`;

// ───────────── UID 解析 ─────────────

function loadUidCache(): Record<string, string> {
  try { return JSON.parse(readFileSync(UID_CACHE, "utf-8")); } catch { return {}; }
}

async function resolveUid(ws: WebSocket, handle: string): Promise<string | null> {
  if (/^\d+$/.test(handle)) return handle; // 纯数字 UID
  // 中文名：m.weibo.cn/n/<name> 302 跳转
  const navUrl = `https://m.weibo.cn/n/${encodeURIComponent(handle)}`;
  await cdp(ws, "Page.navigate", { url: navUrl });
  await sleep(4000);
  const r1 = await cdp(ws, "Runtime.evaluate", { expression: FINAL_URL_JS, returnByValue: true });
  const finalUrl: string = r1?.result?.value ?? "";
  const m = finalUrl.match(/\/u\/(\d+)/);
  if (m) return m[1];
  // 英文 ID：API 搜索
  const r2 = await cdp(ws, "Runtime.evaluate", {
    expression: SEARCH_UID_JS(handle), returnByValue: true, awaitPromise: true,
  });
  const found = r2?.result?.value as { uid: string | null } | undefined;
  return found?.uid ?? null;
}

async function collectWeibo(ws: WebSocket, url: string): Promise<{ text: string; time: string }[]> {
  await cdp(ws, "Page.navigate", { url });
  let rows: { text: string; time: string }[] = [];
  for (let i = 0; i < 6; i++) {
    await sleep(2500);
    try {
      const r = await cdp(ws, "Runtime.evaluate", { expression: EXTRACT_JS, returnByValue: true });
      rows = (r?.result?.value as typeof rows) ?? [];
      if (rows.length > 0) break;
    } catch { /* 页面切换中 */ }
  }
  return rows;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// ───────────── 主流程 ─────────────

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback = "") => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };

  const date = get("--date", "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("[weibo-watch] 必须提供 --date YYYY-MM-DD");
    process.exit(1);
  }
  const stream = get("--stream", "cn-news");
  const runDir = path.resolve(ROOT, get("--run-dir", path.join("runs", date, stream)));
  const handlesArg = get("--handles");
  const limit = parseInt(get("--limit", "0"), 10);

  const wlPath = path.join(ROOT, "config", "weibo-watchlist.json");
  let accounts: WeiboAccount[] = JSON.parse(readFileSync(wlPath, "utf-8")).accounts;
  if (handlesArg) {
    const hs = new Set(handlesArg.split(",").map((h) => h.trim()).filter(Boolean));
    accounts = accounts.filter((a) => hs.has(a.handle) || hs.has(a.name));
    if (!accounts.length) { console.error("[weibo-watch] --handles 无匹配"); process.exit(1); }
  }
  if (limit > 0) accounts = accounts.slice(0, limit);
  console.log(`[weibo-watch] ${date} ${stream} 待采集 ${accounts.length} 个账号 ...`);

  let targets;
  try {
    targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  } catch {
    console.error(`[weibo-watch] 专用浏览器 CDP ${CDP_PORT} 不可达`);
    process.exit(1);
  }
  const page = targets.find((t: any) => t.type === "page" && !t.url.startsWith("chrome"));
  const ws = await connect(page.webSocketDebuggerUrl);
  await cdp(ws, "Page.enable");
  await cdp(ws, "Runtime.enable");

  const uidCache = loadUidCache();
  const items: WeiboItem[] = [];
  const failed: { handle: string; error: string }[] = [];

  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i];
    process.stdout.write(`  [${i + 1}/${accounts.length}] ${a.name}(${a.handle}) ... `);
    try {
      let uid: string | null = uidCache[a.handle] ?? null;
      if (!uid) {
        // 优先用中文名走 /n/<name> 跳转（英文 ID 无法直接解析 UID）
        uid = await resolveUid(ws, a.name);
        if (uid) {
          uidCache[a.handle] = uid;
          await writeFile(UID_CACHE, JSON.stringify(uidCache, null, 2), "utf-8");
        }
      }
      if (!uid) {
        failed.push({ handle: a.handle, error: "UID 解析失败" });
        console.log("UID 解析失败");
        continue;
      }
      const rows = await collectWeibo(ws, `https://m.weibo.cn/u/${uid}`);
      if (!rows.length) {
        failed.push({ handle: a.handle, error: "无内容（页面加载失败/账号不存在）" });
        console.log("无内容");
        continue;
      }
      for (const r of rows) {
        items.push({
          id: `wb-${uid}-${Math.abs(hash(r.text.slice(0, 50)))}`,
          title: r.text,
          url: `https://weibo.com/u/${uid}`,
          source: `微博@${a.name}`,
          publishedAt: new Date().toISOString(),
          category: "other",
          official: a.official ?? true,
          handle: a.handle,
          org: a.org,
        });
      }
      console.log(`${rows.length} 条`);
    } catch (e) {
      failed.push({ handle: a.handle, error: (e as Error).message });
      console.log("失败: " + (e as Error).message);
    }
    await sleep(400);
  }
  ws.close();

  const outDir = path.join(runDir, "research");
  const outPath = path.join(outDir, "weibo-watch.json");
  // --handles 补采模式：合并已有结果，避免覆盖全量
  let prevItems: WeiboItem[] = [];
  let prevFailed: { handle: string; error: string }[] = [];
  if (handlesArg && existsSync(outPath)) {
    try {
      const prev = JSON.parse(readFileSync(outPath, "utf-8"));
      prevItems = prev.items ?? [];
      prevFailed = prev.failed ?? [];
    } catch { /* 旧文件损坏忽略 */ }
  }
  const mergedItems = [...prevItems];
  const seen = new Set(mergedItems.map((it) => it.id));
  for (const it of items) {
    if (!seen.has(it.id)) { mergedItems.push(it); seen.add(it.id); }
  }
  const mergedFailed = [...prevFailed];
  const failedSet = new Set(mergedFailed.map((f) => f.handle));
  for (const f of failed) {
    if (!failedSet.has(f.handle)) { mergedFailed.push(f); failedSet.add(f.handle); }
  }

  const out = {
    schema_version: 1,
    business_date: date,
    stream,
    collected_at: new Date().toISOString(),
    total: mergedItems.length,
    accounts_ok: accounts.length - failed.length,
    accounts_failed: mergedFailed.length,
    failed: mergedFailed,
    items: mergedItems,
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, JSON.stringify(out, null, 2), "utf-8");
  await markStageDone(`weibo-${stream}-${date}`, "research", {
    input_summary: `weibo accounts=${accounts.length} ok=${accounts.length - failed.length} fail=${failed.length}`,
    outputs: [path.relative(ROOT, outPath)],
  });

  console.log(`\n[weibo-watch] 完成：${items.length} 条 / ${accounts.length} 账号 → ${path.relative(ROOT, outPath)}`);
  if (failed.length) console.log("[weibo-watch] 失败: " + failed.map((f) => `${f.handle}(${f.error})`).join("; "));
}

const isDirectRun =
  process.argv[1] &&
  (import.meta.url === new URL("file://" + path.resolve(process.argv[1])).href ||
    import.meta.url.endsWith("/" + path.basename(process.argv[1])));
if (isDirectRun) {
  main().catch((e) => {
    console.error("[weibo-watch] 失败:", e);
    process.exit(1);
  });
}
