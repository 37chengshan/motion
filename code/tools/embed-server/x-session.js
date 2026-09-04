// x-session.js — 解密 Chrome X cookie 并验证登录态（一次性验证脚本）
// 用法: node x-session.js [action]  action: verify | timeline
// 安全: AES key 从 chrome_key.py 运行时获取；解密后的凭证只在进程内使用，不写盘
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");

const PY = "D:/motion/code/tools/embed-server/.venv3/Scripts/python.exe";
const SCRIPTS = "D:/motion/code/tools/embed-server";

function getAesKey() {
  const b64 = execFileSync(PY, [SCRIPTS + "/chrome_key.py"], { encoding: "utf-8" }).trim();
  return Buffer.from(b64, "base64");
}

function getCookies() {
  const raw = execFileSync(PY, [SCRIPTS + "/export_cookies.py"], { encoding: "utf-8" });
  return JSON.parse(raw);
}

function decryptValue(key, encB64) {
  const buf = Buffer.from(encB64, "base64");
  if (buf.length < 15 || buf[0] !== 0x76 || buf[1] !== 0x31 || buf[2] !== 0x30) {
    return null; // 非 v10 格式（明文 cookie）
  }
  const nonce = buf.subarray(3, 15);
  const tag = buf.subarray(buf.length - 16);
  const data = buf.subarray(15, buf.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf-8");
}

function buildCookieHeader(key, cookies) {
  const parts = [];
  for (const c of cookies) {
    const v = decryptValue(key, c.enc);
    if (v !== null && v !== "") parts.push(`${c.name}=${v}`);
  }
  return parts.join("; ");
}

async function main() {
  const action = process.argv[2] ?? "verify";
  const key = getAesKey();
  const cookies = getCookies();
  const header = buildCookieHeader(key, cookies);
  const auth = cookies.find((c) => c.name === "auth_token");
  const ct0 = cookies.find((c) => c.name === "ct0");
  console.log(`[x] cookies=${cookies.length} auth_token=${auth ? "YES" : "NO"} ct0=${ct0 ? "YES" : "NO"}`);

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Cookie": header,
    "x-csrf-token": ct0 ? decryptValue(key, ct0.enc) : "",
    "Authorization": "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
    "x-twitter-client-language": "en",
    "x-twitter-active-user": "yes",
    "Referer": "https://x.com/OpenAI",
    "Origin": "https://x.com",
    "Sec-Fetch-Site": "same-origin",
  };

  if (action === "verify") {
    // 登录态验证：account settings（需要登录）
    const res = await fetch("https://x.com/i/api/1.1/account/settings.json", { headers });
    const text = await res.text();
    console.log(`[x] account/settings HTTP ${res.status}`);
    if (res.ok) {
      const j = JSON.parse(text);
      console.log(`[x] 登录用户: ${j.screen_name} (id=${j.id_str})`);
    } else {
      console.log(`[x] 未登录或凭证无效: ${text.slice(0, 200)}`);
    }
  } else if (action === "timeline") {
    const screen = process.argv[3] ?? "OpenAI";
    // UserByScreenName → userId
    const r1 = await fetch(
      `https://x.com/i/api/graphql/7mjxD3X6B2hJ6hx0l5zV7A/UserByScreenName?variables=${encodeURIComponent(JSON.stringify({ screen_name: screen, withSafetyModeUserFields: true }))}`,
      { headers }
    );
    const j1 = await r1.json();
    const userId = j1?.data?.user?.result?.rest_id;
    if (!userId) {
      console.log(`[x] UserByScreenName 失败 HTTP ${r1.status}: ${JSON.stringify(j1).slice(0, 200)}`);
      return;
    }
    console.log(`[x] ${screen} -> userId=${userId}`);
  }
}

main().catch((e) => {
  console.error("[x] 失败:", e.message);
  process.exit(1);
});
