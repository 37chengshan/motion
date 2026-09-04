// x-cdp.js — 通过 CDP(9223) 从专用浏览器取 X 明文 cookie 并验证登录态
// 用法: node x-cdp.js verify | cookies
// 安全: cookie 只输出到 stdout 或内存变量，不写盘（cookies 模式输出到 D:/motion/data/x-cookies.json 供采集脚本用）
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const CDP_PORT = 9223;
// X API 请求走本地代理（沙箱直连被 X 风控返回空）
const PROXY = process.env.X_PROXY ?? "http://127.0.0.1:7890";

function cdpCall(ws, id, method, params = {}) {
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

async function getXCookies() {
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const xPage = targets.find((t) => t.type === "page" && /x\.com|twitter\.com/.test(t.url));
  if (!xPage) throw new Error("未找到 X 页面，请先登录 X（当前标签: " + targets.map((t) => t.url).join(" | ") + "）");
  const ws = new WebSocket(xPage.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const r = await cdpCall(ws, 1, "Network.getAllCookies");
  ws.close();
  return r.cookies.filter((c) => /\.x\.com$|\.twitter\.com$/.test(c.domain));
}

async function main() {
  const action = process.argv[2] ?? "verify";
  const cookies = await getXCookies();
  const byName = (n) => cookies.find((c) => c.name === n);
  const auth = byName("auth_token"), ct0 = byName("ct0"), twid = byName("twid");
  console.log(`[x] CDP cookies=${cookies.length} auth_token=${auth ? "YES" : "NO"} ct0=${ct0 ? "YES" : "NO"} twid=${twid ? "YES" : "NO"}`);
  if (!auth) {
    console.log("[x] 未登录（无 auth_token）。请在专用浏览器窗口完成 X 登录后重试。");
    return;
  }
  if (action === "cookies") {
    mkdirSync("D:/motion/data", { recursive: true });
    writeFileSync("D:/motion/data/x-cookies.json", JSON.stringify(cookies.map((c) => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path,
    })), null, 2));
    console.log(`[x] 已写 D:/motion/data/x-cookies.json（${cookies.length} 条，含明文凭证——勿提交 git）`);
    return;
  }
  // verify: 用 curl 子进程走代理调 X API 确认登录态（Node fetch 在沙箱直连不稳）
  const header = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const args = [
    "-s", "--max-time", "20", "-x", PROXY,
    "https://x.com/i/api/1.1/account/settings.json",
    "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
    "-H", "Accept: application/json, text/plain, */*",
    "-H", `Cookie: ${header}`,
    "-H", `x-csrf-token: ${ct0.value}`,
    "-H", "Authorization: Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
    "-H", "x-twitter-client-language: en",
    "-H", "x-twitter-active-user: yes",
    "-H", "Referer: https://x.com/home",
    "-w", "\n__HTTP__%{http_code}",
  ];
  const out = execFileSync("curl", args, { encoding: "utf-8" });
  const m = out.match(/__HTTP__(\d+)\s*$/);
  const status = m ? Number(m[1]) : 0;
  const body = out.replace(/__HTTP__\d+\s*$/, "").trim();
  console.log(`[x] account/settings HTTP ${status}`);
  if (status === 200) {
    const j = JSON.parse(body);
    console.log(`[x] ✅ 登录用户: @${j.screen_name} (id=${j.id_str})`);
  } else {
    console.log(`[x] ❌ ${body.slice(0, 200)}`);
  }
}

main().catch((e) => {
  console.error("[x] 失败:", e.message);
  process.exit(1);
});
