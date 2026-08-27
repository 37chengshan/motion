// Record a live web page scrolling (its own animations play) via CDP screencast.
// 用法: node record-page.js <url> <outPrefix> [speedFactor]
// 产出: out/<前缀>-frames/*.jpg + list.ffconcat + <前缀>-meta.json
// 60fps 成片: ffmpeg -f concat -safe 0 -i list.ffconcat -vf "minterpolate=fps=60:mi_mode=blend,fps=60,format=yuv420p" -crf 16 out.mp4
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const defaultChrome = "/Users/cc/.cache/hyperframes/chrome/chrome-headless-shell/mac_arm-152.0.7977.30/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const CHROME = process.env.CHROME_BIN || (fs.existsSync(defaultChrome) ? defaultChrome : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
const url = process.argv[2];
const rawPrefix = process.argv[3] || "page";
if (!/^[a-z0-9-]{1,32}$/.test(rawPrefix)) throw new Error("bad outPrefix");
const outPrefix = rawPrefix;
const speed = parseFloat(process.argv[4] || "1");

const OUTDIR = path.resolve(__dirname, "out");
const framesDir = path.join(OUTDIR, outPrefix + "-frames");
if (!framesDir.startsWith(OUTDIR + path.sep)) throw new Error("path escape");
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "shell",
    args: ["--no-sandbox", "--hide-scrollbars", "--force-device-scale-factor=1", "--window-size=1920,1080"],
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));

  const waypoints = await page.evaluate(() => {
    const vh = window.innerHeight;
    const maxScroll = document.documentElement.scrollHeight - vh;
    const tops = [0];
    const els = document.querySelectorAll("section, h2, [class*='hero'], [class*='feature'], [class*='workflow'], [class*='step'], [class*='benchmark'], [class*='demo'], footer");
    els.forEach((el) => {
      const t = el.getBoundingClientRect().top + window.scrollY - vh * 0.18;
      if (t > 200 && t < maxScroll - 200) tops.push(Math.round(t));
    });
    tops.push(maxScroll);
    const uniq = [...new Set(tops)].sort((a, b) => a - b);
    const spaced = [uniq[0]];
    for (const t of uniq.slice(1)) if (t - spaced[spaced.length - 1] > 500) spaced.push(t);
    return { pts: spaced, maxScroll, height: document.documentElement.scrollHeight };
  });
  console.log("waypoints:", JSON.stringify(waypoints));

  const cdp = await page.createCDPSession();
  const frames = [];
  let frameSeq = 0;
  let t0 = 0;
  cdp.on("Page.screencastFrame", async (ev) => {
    const t = (Date.now() - t0) / 1000;
    const file = `f${String(frameSeq++).padStart(5, "0")}.jpg`;
    fs.writeFileSync(path.join(framesDir, file), Buffer.from(ev.data, "base64"));
    frames.push({ file, t });
    try { await cdp.send("Page.screencastFrameAck", { sessionId: ev.sessionId }); } catch (e) {}
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: 1920, maxHeight: 1080, everyFrame: true });
  t0 = Date.now();

  const PAUSE = 1400;
  const VELOCITY = 620 * speed * 12.8;
  await page.evaluate(() => { window.scrollTo({ top: 0 }); });
  await new Promise((r) => setTimeout(r, 1800 / speed));

  for (let i = 1; i < waypoints.pts.length; i++) {
    const from = waypoints.pts[i - 1];
    const to = waypoints.pts[i];
    const dist = to - from;
    const durMs = Math.max(600, (dist / VELOCITY) * 1000);
    const steps = Math.max(8, Math.round(durMs / 16));
    for (let s = 1; s <= steps; s++) {
      const p = s / steps;
      const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const y = Math.round(from + dist * ease);
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await new Promise((r) => setTimeout(r, durMs / steps));
    }
    await new Promise((r) => setTimeout(r, PAUSE));
  }
  await new Promise((r) => setTimeout(r, 800));
  await cdp.send("Page.stopScreencast");
  await new Promise((r) => setTimeout(r, 300));
  await browser.close();

  const lines = ["ffconcat version 1.0"];
  for (let i = 0; i < frames.length; i++) {
    const dur = i < frames.length - 1 ? Math.max(0.01, frames[i + 1].t - frames[i].t) : 0.04;
    lines.push(`file '${frames[i].file}'`, `duration ${dur.toFixed(3)}`);
  }
  lines.push(`file '${frames[frames.length - 1].file}'`);
  fs.writeFileSync(path.join(framesDir, "list.ffconcat"), lines.join("\n") + "\n");
  const total = frames[frames.length - 1].t;
  fs.writeFileSync(path.join(OUTDIR, outPrefix + "-meta.json"), JSON.stringify({ frames: frames.length, total, height: waypoints.height }, null, 1));
  console.log(`captured ${frames.length} frames, ${total.toFixed(1)}s`);
})();
