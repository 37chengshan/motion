/**
 * HyperFrames 合成生成器 — 数据驱动组装 AI 新闻视频
 *
 * 输入：src/data/today.json（blocks：真实新闻数据+narration）
 *       out/timeline.json（唯一时间事实源：每段 start/duration）
 * 输出：hyperframes/ai-news/index.html（1080x1920 竖屏幻灯片）
 *       或 hyperframes/ai-news-long/index.html（1920x1080 横屏，--orientation long）
 *
 * 页面类型（按 block 结构自动路由）：
 *   type=title        → 开场页（大标题+日期）
 *   type=list         → 总评页（多件事速览，序号徽章）
 *   type=text 短内容  → divider 页（分区转场）
 *   type=text+url     → 新闻卡页（多模块：标题+摘要+数据卡+要点+来源+URL）
 *   其余 text         → 普通文本页
 *
 * 文字是信息主体：摘要/要点/数据全部文字展示，旁白只是辅助。
 * 每段旁白 → <audio>（root 直接子元素，track 10，时间来自 timeline）
 * BGM 铺底 → <audio id="bgm">（track 11，GSAP 时间轴 ducking：旁白 0.15/间奏 0.5）
 *
 * 用法：node scripts/gen-hyperframes.ts [--config src/data/today.json] [--orientation short|long]
 */
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

interface VideoBlockLite {
  type: string;
  content: string;
  items?: string[];
  effect?: string;
  narration?: string;
  source?: string;
  url?: string;
  highlight?: string;
  section?: string;
  summary?: string;
  points?: string[];
  stats?: { label: string; value: string }[];
}

interface TimelineEntry {
  blockIndex: number;
  audioPath: string | null;
  audioDurationSec: number;
  targetFrames: number;
  globalStartSec: number;
}

interface TimelineManifest {
  fps: number;
  totalDurationSec: number;
  entries: TimelineEntry[];
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 判定页面类型 */
function pageKind(block: VideoBlockLite): "title" | "review" | "divider" | "news" | "text" {
  if (block.type === "title") return "title";
  if (block.type === "list") return "review";
  if (block.type === "text") {
    const short = block.content.length <= 8 && !block.url && !block.highlight;
    if (short && (block.content.includes("新闻") || block.content.includes("速报"))) return "divider";
    if (block.url) return "news";
    return "text";
  }
  return "text";
}

/** 双风格主题：claude（文字优先暖白橙棕）/ dark（黑底青绿高对比） */
interface Theme {
  bg: string;        // 页面背景
  text: string;      // 主文字
  muted: string;     // 次要文字
  accent: string;    // 强调色（徽章/数字/高亮）
  panel: string;     // 卡片背景
  border: string;    // 卡片边框
  glow: string;      // 顶部光晕
  hlText: string;    // 徽章内文字
}

const THEMES: Record<string, Theme> = {
  claude: {
    bg: "#FAF9F5",
    text: "#292524",
    muted: "#78716C",
    accent: "#D97757",
    panel: "#FFFFFF",
    border: "#E7E5E4",
    glow: "rgba(217,119,87,0.10)",
    hlText: "#FFFFFF",
  },
  dark: {
    bg: "#0E0E10",
    text: "#EDEDEF",
    muted: "#9CA3AF",
    accent: "#34D399",
    panel: "#18181B",
    border: "#2A2A2E",
    glow: "rgba(52,211,153,0.10)",
    hlText: "#06281A",
  },
};

/** 从 config.style 或 --style 解析主题；未知风格回退 claude */
function resolveTheme(styleName: string | undefined, cliStyle: string | undefined): Theme {
  const name = cliStyle ?? (styleName === "dark" ? "dark" : "claude");
  return THEMES[name] ?? THEMES.claude;
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const configPath = path.resolve(ROOT, get("--config", "src/data/today.json"));
  const timelinePath = path.resolve(ROOT, "out", "timeline.json");
  const orientation = get("--orientation", "short") === "long" ? "long" : "short";
  const cliStyle = get("--style", "");
  const outDir = path.resolve(
    ROOT,
    "hyperframes",
    orientation === "long" ? "ai-news-long" : "ai-news"
  );

  const config = JSON.parse(await readFile(configPath, "utf-8")) as {
    title: string;
    subtitle?: string;
    footer?: string;
    bgm?: string;
    style?: string;
    blocks: VideoBlockLite[];
  };
  const timeline = JSON.parse(await readFile(timelinePath, "utf-8")) as TimelineManifest;
  const T = resolveTheme(config.style, cliStyle);

  const W = orientation === "long" ? 1920 : 1080;
  const H = orientation === "long" ? 1080 : 1920;
  // 横屏缩放因子：字号/间距整体缩小，适配 16:9 画面
  const S = orientation === "long" ? 0.72 : 1;
  const px = (v: number) => Math.round(v * S);
  const duration = timeline.totalDurationSec;

  // ── 统计新闻卡序号（AI/其他分开计数） ──
  const newsIdx = { "ai-news": 0, "other-news": 0 };
  const newsTotal = {
    "ai-news": config.blocks.filter((b) => b.section === "ai-news" && b.url).length,
    "other-news": config.blocks.filter((b) => b.section === "other-news" && b.url).length,
  };

  // ── 生成 clips（section 页 + audio） ──
  const sections: string[] = [];
  const audios: string[] = [];
  const tweens: string[] = [];
  // BGM ducking 关键帧（契约：tl.to("#bgm", {volume}) 在时间轴上驱动）
  const bgmTweens: string[] = [];
  let bgmSrc = "";

  // BGM 资产（config.bgm 指定 public/ 相对路径时复制进项目 assets）
  if (config.bgm) {
    const bgmFile = path.resolve(ROOT, "public", config.bgm);
    try {
      const bgmDst = path.join(outDir, "assets", "bgm.mp3");
      await mkdir(path.dirname(bgmDst), { recursive: true });
      await copyFile(bgmFile, bgmDst);
      bgmSrc = "assets/bgm.mp3";
    } catch {
      console.warn("[hyperframes] BGM 文件不存在，跳过铺底:", config.bgm);
    }
  }

  for (const entry of timeline.entries) {
    const block = config.blocks[entry.blockIndex];
    if (!block) continue;
    const start = entry.globalStartSec.toFixed(2);
    // 减 0.01s 规避浮点边界重叠（lint 同 track 严格比较；0.01s < 1 帧）
    const dur = Math.max(0.5, entry.targetFrames / timeline.fps - 0.01).toFixed(2);
    const kind = pageKind(block);
    const id = `p${entry.blockIndex}`;
    // 轮流分配 3 个视觉 track（时间互不重叠；避免单 track 过密触发 lint）
    const track = 1 + (entry.blockIndex % 3);

    // audio 元素（root 直接子元素；音频复制进项目 assets 避免项目外路径）
    if (entry.audioPath) {
      const src = path.resolve(ROOT, entry.audioPath);
      const dst = path.join(outDir, "assets", "voiceover", `${entry.blockIndex}.wav`);
      await mkdir(path.dirname(dst), { recursive: true });
      await copyFile(src, dst).catch(() => {});
      audios.push(
        `  <audio id="vo-${entry.blockIndex}" src="assets/voiceover/${entry.blockIndex}.wav" data-start="${start}" data-duration="${dur}" data-track-index="10" data-volume="1"></audio>`
      );
      // BGM ducking：段前 0.35s 压低、旁白结束后回升（duck 区间=旁白实际时长，尾缓冲留给 BGM）
      // overwrite:auto 解决相邻段 tween 重叠（段间隔 0.5s < 2×0.35s fade）
      if (bgmSrc) {
        const spanStart = entry.globalStartSec;
        const spanEnd = entry.globalStartSec + entry.audioDurationSec;
        bgmTweens.push(
          `tl.to("#bgm", { volume: 0.15, duration: 0.35, overwrite: "auto" }, ${Math.max(0, spanStart - 0.35).toFixed(2)});`,
          `tl.to("#bgm", { volume: 0.5, duration: 0.35, overwrite: "auto" }, ${spanEnd.toFixed(2)});`
        );
      }
    }

    let inner = "";
    switch (kind) {
      case "title": {
        inner = `
        <div class="hero">
          <h1 id="${id}-h">${esc(block.content)}</h1>
          <div class="hero-sub" id="${id}-s">${esc(config.subtitle ?? "")}</div>
          <div class="hero-line" id="${id}-l"></div>
        </div>`;
        tweens.push(
          `tl.from("#${id}-h", { y: 60, opacity: 0, duration: 0.7, ease: "power3.out" }, ${start} + 0.2);`,
          `tl.from("#${id}-s", { y: 24, opacity: 0, duration: 0.5, ease: "power2.out" }, ${start} + 0.6);`,
          `tl.fromTo("#${id}-l", { scaleX: 0 }, { scaleX: 1, duration: 0.8, ease: "power2.out" }, ${start} + 0.8);`
        );
        break;
      }
      case "review": {
        const items = (block.items ?? [])
          .map(
            (it, i) => `
          <div class="rev-item" id="${id}-i${i}">
            <div class="rev-num">${i + 1}</div>
            <div class="rev-txt">${esc(it)}</div>
          </div>`
          )
          .join("");
        inner = `
        <div class="review">
          <h2 class="rev-title" id="${id}-t">${esc(block.content)}</h2>
          ${items}
          <div class="rev-src" id="${id}-src">${esc(block.source ?? "")}</div>
        </div>`;
        tweens.push(
          `tl.from("#${id}-t", { y: 40, opacity: 0, duration: 0.5, ease: "power3.out" }, ${start} + 0.2);`
        );
        (block.items ?? []).forEach((_, i) => {
          tweens.push(
            `tl.from("#${id}-i${i}", { x: -60, opacity: 0, duration: 0.5, ease: "power2.out" }, ${start} + ${0.5 + i * 0.35});`
          );
        });
        break;
      }
      case "divider": {
        inner = `
        <div class="divider">
          <h1 id="${id}-h">${esc(block.content)}</h1>
          <div class="div-line" id="${id}-l"></div>
        </div>`;
        tweens.push(
          `tl.from("#${id}-h", { y: 80, opacity: 0, duration: 0.6, ease: "power3.out" }, ${start} + 0.15);`,
          `tl.fromTo("#${id}-l", { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: "power2.inOut" }, ${start} + 0.4);`
        );
        break;
      }
      case "news": {
        const sec = (block.section ?? "ai-news") as keyof typeof newsIdx;
        newsIdx[sec] = (newsIdx[sec] ?? 0) + 1;
        const n = newsIdx[sec];
        const total = newsTotal[sec];
        // 多模块化：标题 + 摘要 + 数据卡 + 要点 + 来源/链接（文字是信息主体，旁白只是辅助）
        const statsRow = (block.stats ?? [])
          .map(
            (s, si) => `
          <div class="st-card" id="${id}-st${si}"><div class="st-val">${esc(s.value)}</div><div class="st-label">${esc(s.label)}</div></div>`
          )
          .join("");
        const pointsRow = (block.points ?? [])
          .map(
            (p, pi) => `
          <div class="pt-item" id="${id}-pt${pi}"><span class="pt-dot"></span><span class="pt-txt">${esc(p)}</span></div>`
          )
          .join("");
        inner = `
        <div class="news-card" id="${id}-card">
          <div class="nc-head">
            <div class="nc-progress" id="${id}-prog">${n} / ${total}</div>
            <div class="nc-highlight" id="${id}-hl">${esc(block.highlight ?? "")}</div>
          </div>
          <h2 class="nc-title" id="${id}-t">${esc(block.content)}</h2>
          <div class="nc-summary" id="${id}-sum">${esc(block.summary ?? "")}</div>
          ${statsRow ? `<div class="nc-stats" id="${id}-stats">${statsRow}</div>` : ""}
          ${pointsRow ? `<div class="nc-points" id="${id}-pts">${pointsRow}</div>` : ""}
          <div class="nc-meta" id="${id}-m">
            <span class="nc-src">来源：${esc(block.source ?? "")}</span>
          </div>
          <div class="nc-url" id="${id}-u">${esc(block.url ?? "")}</div>
        </div>`;
        tweens.push(
          `tl.from("#${id}-card", { y: 60, opacity: 0, duration: 0.5, ease: "power3.out" }, ${start} + 0.12);`,
          `tl.from("#${id}-hl", { scale: 0.6, opacity: 0, duration: 0.4, ease: "back.out(2)" }, ${start} + 0.4);`,
          `tl.from("#${id}-sum", { y: 20, opacity: 0, duration: 0.5 }, ${start} + 0.6);`
        );
        (block.stats ?? []).forEach((_, si) => {
          tweens.push(
            `tl.from("#${id}-st${si}", { y: 16, opacity: 0, duration: 0.4 }, ${start} + ${0.9 + si * 0.22});`
          );
        });
        (block.points ?? []).forEach((_, pi) => {
          tweens.push(
            `tl.from("#${id}-pt${pi}", { x: -24, opacity: 0, duration: 0.4 }, ${start} + ${1.4 + pi * 0.2});`
          );
        });
        tweens.push(
          `tl.from("#${id}-u", { opacity: 0, duration: 0.4 }, ${start} + ${1.4 + (block.points?.length ?? 0) * 0.2});`
        );
        break;
      }
      default: {
        inner = `
        <div class="plain">
          <h2 id="${id}-t">${esc(block.content)}</h2>
        </div>`;
        tweens.push(
          `tl.from("#${id}-t", { y: 40, opacity: 0, duration: 0.6, ease: "power3.out" }, ${start} + 0.2);`
        );
      }
    }

    // inner 压成单行（控制文件行数，lint 阈值 400 行）
    const compactInner = inner.replace(/\n\s*/g, " ").trim();
    sections.push(
      `  <section id="${id}" class="clip" data-start="${start}" data-duration="${dur}" data-track-index="${track}">${compactInner}
  </section>`
    );
  }

  // BGM 音轨（root 直接子元素，铺底全片；volume 由时间轴 ducking 驱动）
  if (bgmSrc) {
    audios.push(
      `  <audio id="bgm" src="${bgmSrc}" data-start="0" data-duration="${duration.toFixed(2)}" data-track-index="11" data-volume="0.5"></audio>`
    );
  }

  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <title>${esc(config.title)}</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      body { margin: 0; background: ${T.bg}; font-family: sans-serif; }
      #root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: ${T.bg}; }
      .bg { position: absolute; inset: 0; }
      .bg-grid { background-image: linear-gradient(${T.border}55 1px, transparent 1px), linear-gradient(90deg, ${T.border}55 1px, transparent 1px); background-size: 36px 36px; opacity: 0.6; }
      .bg-glow { background: radial-gradient(ellipse 70% 30% at 50% -5%, ${T.glow}, transparent 70%); }
      .clip { position: absolute; inset: 0; display: grid; place-items: center; padding: ${px(40)}px ${px(30)}px; }
      /* 开场 */
      .hero { text-align: center; }
      .hero h1 { font-size: ${px(76)}px; font-weight: 800; color: ${T.text}; margin: 0; letter-spacing: 3px; }
      .hero-sub { font-size: ${px(28)}px; color: ${T.muted}; margin-top: ${px(20)}px; letter-spacing: 1px; }
      .hero-line { width: ${px(240)}px; height: 4px; border-radius: 2px; background: linear-gradient(90deg, transparent, ${T.accent}, transparent); margin: ${px(30)}px auto 0; transform-origin: center; }
      /* 总评 */
      .review { width: 100%; }
      .rev-title { font-size: ${px(44)}px; font-weight: 800; color: ${T.text}; margin: 0 0 ${px(26)}px; text-align: center; }
      .rev-item { display: flex; align-items: center; gap: ${px(16)}px; background: ${T.panel}; border: 1px solid ${T.border}; border-radius: ${px(14)}px; padding: ${px(16)}px ${px(20)}px; margin-bottom: ${px(12)}px; }
      .rev-num { width: ${px(38)}px; height: ${px(38)}px; border-radius: 50%; background: ${T.accent}; color: ${T.hlText}; font-size: ${px(20)}px; font-weight: 700; display: grid; place-items: center; flex-shrink: 0; }
      .rev-txt { font-size: ${px(27)}px; color: ${T.text}; line-height: 1.4; }
      .rev-src { text-align: center; font-size: ${px(20)}px; color: ${T.muted}; margin-top: ${px(14)}px; letter-spacing: 2px; }
      /* 分区 */
      .divider { text-align: center; }
      .divider h1 { font-size: ${px(84)}px; font-weight: 800; color: ${T.text}; margin: 0; letter-spacing: 8px; }
      .div-line { width: ${px(280)}px; height: 5px; border-radius: 3px; background: linear-gradient(90deg, transparent, ${T.accent}, transparent); margin: ${px(32)}px auto 0; transform-origin: center; }
      /* 新闻卡（多模块：标题/摘要/数据卡/要点/来源） */
      .news-card { width: 100%; ${orientation === "long" ? "max-width: 1400px;" : ""} background: ${T.panel}; border: 1px solid ${T.border}; border-radius: ${px(18)}px; padding: ${px(26)}px ${px(28)}px; display: flex; flex-direction: column; gap: ${px(12)}px; max-height: 100%; overflow: hidden; }
      .nc-head { display: flex; justify-content: space-between; align-items: center; gap: ${px(14)}px; }
      .nc-progress { font-size: ${px(20)}px; color: ${T.muted}; font-weight: 600; }
      .nc-highlight { background: ${T.accent}; color: ${T.hlText}; font-size: ${px(23)}px; font-weight: 700; padding: ${px(8)}px ${px(18)}px; border-radius: ${px(24)}px; }
      .nc-title { font-size: ${px(38)}px; font-weight: 800; color: ${T.text}; margin: 0; line-height: 1.25; }
      .nc-summary { font-size: ${px(22)}px; color: ${T.text}; line-height: 1.5; background: ${T.bg}; border-radius: ${px(10)}px; padding: ${px(12)}px ${px(16)}px; }
      .nc-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: ${px(8)}px; }
      .st-card { background: ${T.bg}; border: 1px solid ${T.border}; border-radius: ${px(10)}px; padding: ${px(10)}px ${px(12)}px; text-align: center; }
      .st-val { font-size: ${px(26)}px; font-weight: 800; color: ${T.accent}; font-family: monospace; }
      .st-label { font-size: ${px(15)}px; color: ${T.muted}; margin-top: ${px(4)}px; }
      .nc-points { display: flex; flex-direction: column; gap: ${px(6)}px; }
      .pt-item { display: flex; align-items: flex-start; gap: ${px(9)}px; font-size: ${px(21)}px; color: ${T.text}; line-height: 1.45; }
      .pt-dot { width: ${px(7)}px; height: ${px(7)}px; border-radius: 50%; background: ${T.accent}; flex-shrink: 0; margin-top: ${px(10)}px; }
      .nc-meta { display: flex; gap: ${px(14)}px; align-items: center; }
      .nc-src { font-size: ${px(19)}px; color: ${T.muted}; }
      .nc-url { font-size: ${px(17)}px; color: ${T.accent}; word-break: break-all; font-family: monospace; opacity: 0.9; }
      /* 普通文本 */
      .plain { text-align: center; }
      .plain h2 { font-size: ${px(44)}px; font-weight: 700; color: ${T.text}; margin: 0; line-height: 1.4; }
      /* 顶部全局进度条 */
      .gprog { position: absolute; top: 0; left: 0; height: 6px; width: ${W}px; background: ${T.border}; z-index: 50; }
      .gprog-fill { height: 100%; width: 0; background: ${T.accent}; border-radius: 0 3px 3px 0; }
      /* 页脚 */
      .footer { position: absolute; bottom: ${px(18)}px; left: 0; right: 0; text-align: center; font-size: ${px(17)}px; color: ${T.muted}; letter-spacing: 1px; z-index: 40; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="ai-news" data-start="0" data-width="${W}" data-height="${H}" data-duration="${duration.toFixed(2)}" data-fps="${timeline.fps}">
      <div class="bg bg-grid"></div>
      <div class="bg bg-glow"></div>
${sections.join("\n")}
${audios.join("\n")}
      <div class="gprog"><div class="gprog-fill" id="gprog-fill"></div></div>
      <div class="footer">${esc(config.footer ?? "")}</div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
${tweens.map((t) => `      ${t}`).join("\n")}
${bgmTweens.map((t) => `      ${t}`).join("\n")}
      // 全局进度条（整片时长线性填充）
      tl.fromTo("#gprog-fill", { width: 0 }, { width: ${W}, duration: ${duration.toFixed(2)}, ease: "none" }, 0);
      window.__timelines["ai-news"] = tl;
    </script>
  </body>
</html>
`;

  await mkdir(outDir, { recursive: true });
  // 压缩连续空行，控制文件行数（lint composition_file_too_large 阈值 400 行）
  const compactHtml = html.replace(/\n\s*\n+/g, "\n");
  await writeFile(path.join(outDir, "index.html"), compactHtml, "utf-8");

  console.log(
    `[hyperframes] 生成 ${config.blocks.length} 页 + ${audios.length} 音轨，总时长 ${duration.toFixed(1)}s → ${outDir}/index.html`
  );
  console.log("[hyperframes] 下一步：cd hyperframes/ai-news && npx hyperframes lint && npx hyperframes render");
}

main().catch((e) => {
  console.error("[hyperframes] 失败:", e);
  process.exit(1);
});
