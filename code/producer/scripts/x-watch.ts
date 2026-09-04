/**
 * X 官方/研究员账号采集（Phase 3 x-watch）— 走专用浏览器 CDP(9223) 登录态
 *
 * 背景：Chrome 152 默认 profile 拒绝 --remote-debugging-port（安全限制），且 Chrome
 * 新版 cookie 为 v20 App-Bound 加密（用户态无法解密）→ 采用「独立 profile 专用浏览器
 * + 用户登录一次 + CDP Network/Page 域采集」方案（D:/motion/data/x-browser/）。
 *
 * 用法（producer/ 下）：
 *   # 采集全部官方账号（57 个，串行 ~5 分钟）
 *   node scripts/x-watch.ts --date 2026-08-30 --stream ai-news
 *   # 只采指定账号
 *   node scripts/x-watch.ts --date 2026-08-30 --stream ai-news --handles OpenAI,deepseek_ai
 *   # 限量（前 N 个，调试用）
 *   node scripts/x-watch.ts --date 2026-08-30 --stream ai-news --limit 3
 *   # 含员工/研究员账号
 *   node scripts/x-watch.ts --date 2026-08-30 --stream ai-news --include-all
 *
 * 输出：runs/<date>/<stream>/research/x-watch.json（items 与 daily-research raw.json 同构，
 *       可被 score-and-rank 消费）；单账号失败跳过并在 failed 中记录。
 * 前置：专用浏览器已启动且登录（cd tools/.. 见 x-cdp.js 说明；CDP 端口 9223）
 */
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { markStageDone } from "./stage.ts";

const ROOT = process.cwd();
const CDP_PORT = Number(process.env.X_CDP_PORT ?? "9223");

interface WatchAccount {
  handle: string;
  category: string;
  official: boolean;
  verify?: boolean;
  note?: string;
}

interface XWatchItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  category: "ai" | "other";
  handle: string;
  official: boolean;
}

// ───────────── CDP 客户端（Node 原生 WebSocket） ─────────────

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

const EXTRACT_JS = `(() => {
  const out = [];
  const seen = new Set();
  for (const a of document.querySelectorAll('article[data-testid="tweet"]')) {
    const textEl = a.querySelector('[data-testid="tweetText"]');
    const text = textEl ? textEl.innerText : '';
    const timeEl = a.querySelector('time');
    const time = timeEl ? timeEl.getAttribute('datetime') : '';
    const linkEl = a.querySelector('a[href*="/status/"]');
    const url = linkEl ? linkEl.href : '';
    if (!text || seen.has(url)) continue;
    seen.add(url);
    out.push({ text, time, url });
  }
  return out.slice(0, 20);
})()`;

async function collectHandle(ws: WebSocket, handle: string): Promise<{ text: string; time: string; url: string }[]> {
  await cdp(ws, "Page.navigate", { url: `https://x.com/${handle}` });
  let tweets: { text: string; time: string; url: string }[] = [];
  for (let i = 0; i < 8; i++) {
    await sleep(2500);
    try {
      const r = await cdp(ws, "Runtime.evaluate", { expression: EXTRACT_JS, returnByValue: true });
      tweets = (r?.result?.value as typeof tweets) ?? [];
      if (tweets.length > 0) break;
    } catch {
      /* 页面切换中 */
    }
  }
  return tweets;
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
  const has = (flag: string) => args.includes(flag);

  const date = get("--date", "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("[x-watch] 必须提供 --date YYYY-MM-DD（禁止自取系统日期）");
    process.exit(1);
  }
  const stream = get("--stream", "ai-news");
  const runDir = path.resolve(ROOT, get("--run-dir", path.join("runs", date, stream)));
  const handlesArg = get("--handles");
  const limit = parseInt(get("--limit", "0"), 10);
  const includeAll = has("--include-all");

  // 读取 watchlist
  const wlPath = path.join(ROOT, "config", "x-watchlist.json");
  if (!existsSync(wlPath)) {
    console.error("[x-watch] 缺少 config/x-watchlist.json");
    process.exit(1);
  }
  const wl = JSON.parse(readFileSync(wlPath, "utf-8")) as { accounts: WatchAccount[] };

  let accounts: WatchAccount[] = wl.accounts;
  if (handlesArg) {
    const hs = new Set(handlesArg.split(",").map((h) => h.trim()).filter(Boolean));
    accounts = accounts.filter((a) => hs.has(a.handle));
    if (!accounts.length) {
      console.error("[x-watch] --handles 没有匹配的账号:", handlesArg);
      process.exit(1);
    }
  } else if (!includeAll) {
    accounts = accounts.filter((a) => a.official);
    console.log(`[x-watch] 默认仅官方账号（--include-all 可加员工/研究员）: ${accounts.length} 个`);
  }
  if (limit > 0) accounts = accounts.slice(0, limit);
  console.log(`[x-watch] ${date} ${stream} 待采集 ${accounts.length} 个账号 ...`);

  // CDP 连接
  let targets;
  try {
    targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  } catch {
    console.error(`[x-watch] 专用浏览器 CDP ${CDP_PORT} 不可达。请先启动并登录（D:/motion/data/x-browser profile）`);
    process.exit(1);
  }
  const page = targets.find((t: any) => t.type === "page" && !t.url.startsWith("chrome")) ?? targets.find((t: any) => t.type === "page");
  if (!page) {
    console.error("[x-watch] 无可用页面 target");
    process.exit(1);
  }
  const ws = await connect(page.webSocketDebuggerUrl);
  await cdp(ws, "Page.enable");
  await cdp(ws, "Runtime.enable");

  // 逐账号采集
  const items: XWatchItem[] = [];
  const failed: { handle: string; error: string }[] = [];
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i];
    process.stdout.write(`  [${i + 1}/${accounts.length}] @${a.handle} ... `);
    try {
      const tweets = await collectHandle(ws, a.handle);
      if (!tweets.length) {
        failed.push({ handle: a.handle, error: "无推文（可能账号不存在/需登录/风控）" });
        console.log("无推文");
        continue;
      }
      for (const t of tweets) {
        items.push({
          id: `x-${a.handle.toLowerCase()}-${Math.abs(hash(t.url))}`,
          title: t.text.slice(0, 200),
          url: t.url,
          source: `@${a.handle}`,
          publishedAt: t.time || new Date().toISOString(),
          category: "ai",
          handle: a.handle,
          official: a.official,
        });
      }
      console.log(`${tweets.length} 条`);
    } catch (e) {
      failed.push({ handle: a.handle, error: (e as Error).message });
      console.log("失败: " + (e as Error).message);
    }
    await sleep(500); // 页面间喘息，降低风控
  }
  ws.close();

  // 落盘 runs/<date>/<stream>/research/x-watch.json
  const outDir = path.join(runDir, "research");
  const outPath = path.join(outDir, "x-watch.json");
  // --handles 补采模式：合并已有采集结果，避免覆盖
  let prevItems: XWatchItem[] = [];
  let prevFailed: { handle: string; error: string }[] = [];
  if (handlesArg && existsSync(outPath)) {
    try {
      const prev = JSON.parse(readFileSync(outPath, "utf-8"));
      prevItems = prev.items ?? [];
      prevFailed = prev.failed ?? [];
    } catch {
      /* 旧文件损坏则忽略 */
    }
  }
  const mergedItems = [...prevItems];
  const seen = new Set(mergedItems.map((it) => it.id));
  for (const it of items) {
    if (!seen.has(it.id)) {
      mergedItems.push(it);
      seen.add(it.id);
    }
  }
  const mergedFailed = [...prevFailed];
  const failedSet = new Set(mergedFailed.map((f) => f.handle));
  for (const f of failed) {
    if (!failedSet.has(f.handle)) {
      mergedFailed.push(f);
      failedSet.add(f.handle);
    }
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

  await markStageDone(`xwatch-${stream}-${date}`, "research", {
    input_summary: `x-watch accounts=${accounts.length} ok=${accounts.length - failed.length} fail=${failed.length}`,
    outputs: [path.relative(ROOT, outPath)],
  });

  console.log(`\n[x-watch] 完成：${items.length} 条 / ${accounts.length} 账号 → ${path.relative(ROOT, outPath)}`);
  if (failed.length) {
    console.log("[x-watch] 失败账号: " + failed.map((f) => `@${f.handle}`).join(", "));
  }
}

const isDirectRun =
  process.argv[1] &&
  (import.meta.url === new URL("file://" + path.resolve(process.argv[1])).href ||
    import.meta.url.endsWith("/" + path.basename(process.argv[1])));
if (isDirectRun) {
  main().catch((e) => {
    console.error("[x-watch] 失败:", e);
    process.exit(1);
  });
}
