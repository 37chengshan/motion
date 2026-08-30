// x-verify.js — 核验账号是否存在（CDP 导航 → 页面标题/内容判断）
// 用法: node x-verify.js @handle1,@handle2 ...
import { execFileSync } from "node:child_process";

const CDP_PORT = 9223;

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error("ws connect failed"));
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

const PROBE_JS = `(() => {
  const title = document.title || '';
  const body = (document.body ? document.body.innerText : '').slice(0, 300);
  const h1 = (document.querySelector('h1') || {}).innerText || '';
  const tweetCount = document.querySelectorAll('article[data-testid="tweet"]').length;
  return { title, h1, body, tweetCount };
})()`;

async function main() {
  const handles = (process.argv[2] ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  if (!handles.length) { console.error("用法: node x-verify.js @h1,@h2"); process.exit(1); }

  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === "page" && !t.url.startsWith("chrome"));
  const ws = await connect(page.webSocketDebuggerUrl);
  await cdp(ws, "Page.enable");
  await cdp(ws, "Runtime.enable");

  for (const h of handles) {
    await cdp(ws, "Page.navigate", { url: `https://x.com/${h}` });
    await sleep(4000);
    let r = { title: "", h1: "", body: "", tweetCount: 0 };
    try {
      const rr = await cdp(ws, "Runtime.evaluate", { expression: PROBE_JS, returnByValue: true });
      r = rr.result?.value ?? r;
    } catch {}
    const lost = /doesn'?t exist|not exist|不存在/.test(r.body + r.h1);
    const suspended = /suspended|被暂停/.test(r.body);
    const verdict = lost ? "❌ 账号不存在" : suspended ? "⚠️ 账号被暂停" :
      r.tweetCount > 0 ? `✅ 正常(${r.tweetCount}推)` :
      r.h1 || r.title ? `❓ ${(r.title + " | " + r.h1).slice(0, 50)}` : "❓ 空页";
    console.log(`@${h}: ${verdict}`);
    await sleep(800);
  }
  ws.close();
}
main().catch((e) => { console.error("失败:", e.message); process.exit(1); });
