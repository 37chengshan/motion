// x-collect.js — 通过 CDP(9223) 采集 X 用户主页推文（DOM 提取，走专用浏览器登录态）
// 用法: node x-collect.js <handle> [--count N]
// 输出: JSON 数组 [{text, time, url, handle}] 到 stdout
import { mkdirSync, writeFileSync } from "node:fs";

const CDP_PORT = 9223;
const OUT_DIR = "D:/motion/data/x-collect";

function connect(pageWsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(pageWsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(new Error("ws error"));
  });
}

let msgId = 0;
function cdp(ws, method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === id) {
        ws.removeEventListener("message", onMsg);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 提取推文的 JS（X 页面 DOM）
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
    if (!text) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ text, time, url });
  }
  return out.slice(0, 20);
})()`;

async function main() {
  const handle = process.argv[2];
  if (!handle) {
    console.error("用法: node x-collect.js <handle> [--count N]");
    process.exit(1);
  }
  const countIdx = process.argv.indexOf("--count");
  const count = countIdx >= 0 ? Number(process.argv[countIdx + 1]) || 10 : 10;

  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === "page" && !t.url.startsWith("chrome")) ||
    targets.find((t) => t.type === "page");
  if (!page) throw new Error("没有可用页面 target");

  const ws = await connect(page.webSocketDebuggerUrl);
  await cdp(ws, "Page.enable");
  await cdp(ws, "Runtime.enable");

  // 导航到用户主页
  await cdp(ws, "Page.navigate", { url: `https://x.com/${handle}` });
  // 等待加载：轮询直到出现推文或超时
  let tweets = [];
  for (let i = 0; i < 12; i++) {
    await sleep(3000);
    try {
      const r = await cdp(ws, "Runtime.evaluate", {
        expression: EXTRACT_JS,
        returnByValue: true,
      });
      tweets = r.result?.value ?? [];
      if (tweets.length > 0) break;
    } catch { /* 页面可能还在切换 */ }
  }

  ws.close();
  if (!tweets.length) {
    console.error(`[x] 未提取到推文（页面可能要求登录或 handle 不存在: @${handle}）`);
    process.exit(1);
  }

  const items = tweets.slice(0, count).map((t) => ({
    handle,
    text: t.text,
    time: t.time,
    url: t.url,
  }));

  mkdirSync(OUT_DIR, { recursive: true });
  const file = `${OUT_DIR}/${handle}-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(file, JSON.stringify(items, null, 2));
  console.log(`[x] @${handle} 提取 ${items.length} 条 → ${file}`);
  for (const it of items) {
    console.log(`  • ${(it.time ?? "").slice(0, 10)} ${it.text.slice(0, 80).replace(/\n/g, " ")}`);
  }
}

main().catch((e) => {
  console.error("[x] 失败:", e.message);
  process.exit(1);
});
