// weibo-probe.js — 测试 CDP 提取微博账号主页内容
// 用法: node weibo-probe.js <url>  e.g. https://weibo.com/rmrb
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

const PROBE = `(() => {
  const title = document.title || '';
  const url = location.href;
  // 移动版 m.weibo.cn: .weibo-text / .time; 桌面版: .feed_list_content
  const texts = [];
  document.querySelectorAll('.weibo-text, [node-type="feed_list_content"], .feed_list_content, .txt').forEach(el => {
    const t = (el.innerText || '').trim();
    if (t && t.length > 10) texts.push(t.slice(0, 120));
  });
  return { title, url, sampleCount: texts.length, samples: texts.slice(0, 5) };
})()`;

async function main() {
  const url = process.argv[2];
  if (!url) { console.error("用法: node weibo-probe.js <url>"); process.exit(1); }
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === "page" && !t.url.startsWith("chrome"));
  const ws = await connect(page.webSocketDebuggerUrl);
  await cdp(ws, "Page.enable");
  await cdp(ws, "Runtime.enable");
  await cdp(ws, "Page.navigate", { url });
  await sleep(6000);
  let r = {};
  try {
    const rr = await cdp(ws, "Runtime.evaluate", { expression: PROBE, returnByValue: true });
    r = rr.result?.value ?? {};
  } catch (e) { console.log("evaluate err:", e.message); }
  console.log("title:", r.title);
  console.log("url:", r.url);
  console.log("样本数:", r.sampleCount);
  for (const s of r.samples ?? []) console.log("  •", s);
  ws.close();
}
main().catch((e) => { console.error("失败:", e.message); process.exit(1); });
