/**
 * HyperFrames 合成生成器（§4.1 重构版）— 可导入 generateHyperframes(job) + CLI
 *
 * 输入：config/content.json（blocks）+ timeline/timeline.json（唯一时间事实源）
 * 输出：<runDir>/hyperframes/<compositionId>/index.html（含 assets/ 音频/BGM 副本）
 * 组合 ID：hf-<run-id>-short / hf-<run-id>-long（防多 run 共用 ai-news ID）
 * 契约（§4.2）：
 *   - root data-start="0"、固定 data-width/data-height、data-duration、data-fps
 *   - 单一 paused GSAP timeline，注册到 window.__timelines[<compositionId>]
 *   - DOM id 全部带组合前缀（唯一）；音频由 framework 持有（track 10 voiceover / 11 BGM）
 *
 * 用法（producer/ 下）：
 *   node scripts/gen-hyperframes.ts --run-dir runs/2026-08-28/ai-news-morning --orientation short
 *   node scripts/gen-hyperframes.ts --run-dir runs/2026-08-28/ai-news-morning --orientation long
 */
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

/** 渲染端精简接口（与 src/data/types.ts 的 VideoBlock 保持字段同步）
 *  四方向新增：tag（方向徽章）/ media（素材图）/ subtitle（内嵌字幕条）
 *  —— 本接口若漏写，渲染端将读不到这些字段
 */
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
  tag?: string;
  media?: {
    kind: string;
    src: string;
    caption?: string;
    credit?: string;
    query?: string;
  };
  subtitle?: string;
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

/** §4.1 作业参数（显式传参，不读进程 cwd 隐式单例） */
export interface HyperframesJob {
  /** 完整 run id，如 ai-news-morning-2026-08-28 */
  runId: string;
  configPath: string;
  timelinePath: string;
  runDir: string;
  orientation: "short" | "long";
  style?: string;
  /** 资产根（public/ 所在），默认 producer 根 */
  assetRoot?: string;
  /** 输出目录，默认 <runDir>/hyperframes/<compositionId> */
  outputDir?: string;
}

export interface HyperframesArtifact {
  runId: string;
  compositionId: string;
  orientation: "short" | "long";
  indexHtmlPath: string;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  blocks: number;
  audioCount: number;
  bgmCopied: boolean;
  voiceoverFiles: string[];
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 判定页面类型 */
export function pageKind(block: VideoBlockLite): "title" | "review" | "divider" | "news" | "text" {
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

interface Theme {
  bg: string;
  text: string;
  muted: string;
  accent: string;
  accentDark: string;
  panel: string;
  border: string;
  glow: string;
  hlText: string;
}

const THEMES: Record<string, Theme> = {
  claude: {
    bg: "#FAF9F5",
    text: "#292524",
    muted: "#78716C",
    accent: "#D97757",
    accentDark: "#9A3412",
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
    accentDark: "#6EE7B7",
    panel: "#18181B",
    border: "#2A2A2E",
    glow: "rgba(52,211,153,0.10)",
    hlText: "#06281A",
  },
};

function resolveTheme(styleName: string | undefined, cliStyle: string | undefined): Theme {
  const name = cliStyle ?? (styleName === "dark" ? "dark" : "claude");
  return THEMES[name] ?? THEMES.claude;
}

/** §4.1 生成单个组合（short 或 long）；全部输出写 job.outputDir（run 内） */
export async function generateHyperframes(job: HyperframesJob): Promise<HyperframesArtifact> {
  const orientation = job.orientation;
  const compId = "hf-" + job.runId + "-" + orientation;
  const outDir = path.resolve(ROOT, job.outputDir ?? path.join(job.runDir, "hyperframes", compId));
  const assetRoot = path.resolve(ROOT, job.assetRoot ?? ROOT);

  const config = JSON.parse(await readFile(path.resolve(ROOT, job.configPath), "utf-8")) as {
    title: string;
    subtitle?: string;
    footer?: string;
    bgm?: string;
    style?: string;
    blocks: VideoBlockLite[];
  };
  const timeline = JSON.parse(await readFile(path.resolve(ROOT, job.timelinePath), "utf-8")) as TimelineManifest;
  const T = resolveTheme(config.style, job.style);

  const W = orientation === "long" ? 1920 : 1080;
  const H = orientation === "long" ? 1080 : 1920;
  const S = orientation === "long" ? 0.72 : 1;
  const px = (v: number) => Math.round(v * S);
  const duration = timeline.totalDurationSec;
  const fps = timeline.fps;

  // 动态统计全部 section 的新闻卡数量（四方向扩展：不再硬编码 ai-news/other-news，
  // 否则 intl-news/cn-news/ent-news 会出现「n / 0」进度错误）
  const newsTotal: Record<string, number> = {};
  const newsIdx: Record<string, number> = {};
  for (const b of config.blocks) {
    if (b.section && b.url) {
      newsTotal[b.section] = (newsTotal[b.section] ?? 0) + 1;
      newsIdx[b.section] ??= 0;
    }
  }

  const sections: string[] = [];
  const audios: string[] = [];
  const tweens: string[] = [];
  const subtitleBars: string[] = [];
  const bgmTweens: string[] = [];
  const voiceoverFiles: string[] = [];
  let bgmSrc = "";
  let bgmCopied = false;

  if (config.bgm) {
    const bgmFile = path.resolve(assetRoot, "public", config.bgm);
    try {
      const bgmDst = path.join(outDir, "assets", "bgm.mp3");
      await mkdir(path.dirname(bgmDst), { recursive: true });
      await copyFile(bgmFile, bgmDst);
      bgmSrc = "assets/bgm.mp3";
      bgmCopied = true;
    } catch {
      console.warn("[hyperframes] BGM 文件不存在，跳过铺底:", config.bgm);
    }
  }

  for (const entry of timeline.entries) {
    const block = config.blocks[entry.blockIndex];
    if (!block) continue;
    const start = entry.globalStartSec.toFixed(2);
    const dur = Math.max(0.5, entry.targetFrames / fps - 0.01).toFixed(2);
    const kind = pageKind(block);
    const id = compId + "-p" + entry.blockIndex;
    const track = 1 + (entry.blockIndex % 3);

    if (entry.audioPath) {
      const src = path.resolve(ROOT, entry.audioPath);
      const dst = path.join(outDir, "assets", "voiceover", entry.blockIndex + ".wav");
      await mkdir(path.dirname(dst), { recursive: true });
      await copyFile(src, dst).catch(() => {});
      voiceoverFiles.push(entry.blockIndex + ".wav");
      // 音频 clip 只覆盖音频实际时长（targetFrames 含段尾静音缓冲，
      // 槽位比媒体长会触发 clip_media_fit 警告导致 check --strict 失败）
      const audioDur = Math.max(0.5, entry.audioDurationSec).toFixed(2);
      audios.push(
        '  <audio id="' + compId + '-vo-' + entry.blockIndex + '" src="assets/voiceover/' + entry.blockIndex + '.wav" data-start="' + start + '" data-duration="' + audioDur + '" data-track-index="10" data-volume="1"></audio>'
      );
      if (bgmSrc) {
        const spanStart = entry.globalStartSec;
        const spanEnd = entry.globalStartSec + entry.audioDurationSec;
        bgmTweens.push(
          'tl.to("#bgm", { volume: 0.15, duration: 0.35, overwrite: "auto" }, ' + Math.max(0, spanStart - 0.35).toFixed(2) + ');',
          'tl.to("#bgm", { volume: 0.5, duration: 0.35, overwrite: "auto" }, ' + spanEnd.toFixed(2) + ');'
        );
      }
    }

    // ── 素材图本地化 ──
    // 契约：media.src 为 run 相对路径（runs/<date>/<run>/media/<file>），禁止绝对路径。
    // 复制到 <outDir>/assets/media/，与 voiceover/bgm 同机制。
    // 用 basename 防路径穿越，同时缩短文件名以规避 Windows 260 长路径限制。
    let mediaSrc = "";
    if (block.media?.src) {
      if (path.isAbsolute(block.media.src)) {
        console.warn("[hyperframes] 素材图禁止绝对路径，已忽略:", block.media.src);
      } else {
        const baseName = path.basename(block.media.src);
        const dstName = entry.blockIndex + "-" + baseName;
        const srcAbs = path.resolve(ROOT, job.runDir, "media", baseName);
        const dst = path.join(outDir, "assets", "media", dstName);
        await mkdir(path.dirname(dst), { recursive: true });
        const ok = await copyFile(srcAbs, dst)
          .then(() => true)
          .catch(() => false);
        if (ok) {
          mediaSrc = "assets/media/" + dstName;
        } else {
          console.warn("[hyperframes] 素材图不存在，降级为无素材页:", block.media.src);
        }
      }
    }

    let inner = "";
    switch (kind) {
      case "title": {
        inner =
          '<div class="hero">' +
          '<h1 id="' + id + '-h">' + esc(block.content) + "</h1>" +
          '<div class="hero-sub" id="' + id + '-s">' + esc(config.subtitle ?? "") + "</div>" +
          '<div class="hero-line" id="' + id + '-l"></div>' +
          "</div>";
        tweens.push(
          'tl.from("#' + id + '-h", { y: 60, opacity: 0, duration: 0.7, ease: "power3.out" }, ' + start + ' + 0.2);',
          'tl.from("#' + id + '-s", { y: 24, opacity: 0, duration: 0.5, ease: "power2.out" }, ' + start + ' + 0.6);',
          'tl.fromTo("#' + id + '-l", { scaleX: 0 }, { scaleX: 1, duration: 0.8, ease: "power2.out" }, ' + start + ' + 0.8);'
        );
        break;
      }
      case "review": {
        const items = (block.items ?? [])
          .map(
            (it, i) =>
              '<div class="rev-item" id="' + id + '-i' + i + '">' +
              '<div class="rev-num">' + (i + 1) + "</div>" +
              '<div class="rev-txt">' + esc(it) + "</div></div>"
          )
          .join("");
        inner =
          '<div class="review">' +
          '<h2 class="rev-title" id="' + id + '-t">' + esc(block.content) + "</h2>" +
          items +
          '<div class="rev-src" id="' + id + '-src">' + esc(block.source ?? "") + "</div>" +
          "</div>";
        tweens.push(
          'tl.from("#' + id + '-t", { y: 40, opacity: 0, duration: 0.5, ease: "power3.out" }, ' + start + ' + 0.2);'
        );
        (block.items ?? []).forEach((_, i) => {
          tweens.push(
            'tl.from("#' + id + '-i' + i + '", { x: -60, opacity: 0, duration: 0.5, ease: "power2.out" }, ' + start + ' + ' + (0.5 + i * 0.35) + ');'
          );
        });
        break;
      }
      case "divider": {
        inner =
          '<div class="divider">' +
          '<h1 id="' + id + '-h">' + esc(block.content) + "</h1>" +
          '<div class="div-line" id="' + id + '-l"></div>' +
          "</div>";
        tweens.push(
          'tl.from("#' + id + '-h", { y: 80, opacity: 0, duration: 0.6, ease: "power3.out" }, ' + start + ' + 0.15);',
          'tl.fromTo("#' + id + '-l", { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: "power2.inOut" }, ' + start + ' + 0.4);'
        );
        break;
      }
      case "news": {
        const sec = (block.section ?? "ai-news") as string;
        newsIdx[sec] = (newsIdx[sec] ?? 0) + 1;
        const n = newsIdx[sec];
        const total = newsTotal[sec] ?? 0;
        const statsRow = (block.stats ?? [])
          .map(
            (s, si) =>
              '<div class="st-card" id="' + id + '-st' + si + '"><div class="st-val">' + esc(s.value) + '</div><div class="st-label">' + esc(s.label) + "</div></div>"
          )
          .join("");
        const pointsRow = (block.points ?? [])
          .map(
            (p, pi) =>
              '<div class="pt-item" id="' + id + '-pt' + pi + '"><span class="pt-dot"></span><span class="pt-txt">' + esc(p) + "</span></div>"
          )
          .join("");
        inner =
          '<div class="news-card" id="' + id + '-card">' +
          '<div class="nc-head">' +
          '<div class="nc-progress" id="' + id + '-prog">' + n + " / " + total + "</div>" +
          '<div class="nc-highlight" id="' + id + '-hl">' + esc(block.highlight ?? "") + "</div></div>" +
          '<h2 class="nc-title" id="' + id + '-t">' + esc(block.content) + "</h2>" +
          '<div class="nc-summary" id="' + id + '-sum">' + esc(block.summary ?? "") + "</div>" +
          (statsRow ? '<div class="nc-stats" id="' + id + '-stats">' + statsRow + "</div>" : "") +
          (pointsRow ? '<div class="nc-points" id="' + id + '-pts">' + pointsRow + "</div>" : "") +
          '<div class="nc-meta" id="' + id + '-m"><span class="nc-src">来源：' + esc(block.source ?? "") + "</span></div>" +
          '<div class="nc-url" id="' + id + '-u">' + esc(block.url ?? "") + "</div>" +
          "</div>";
        tweens.push(
          'tl.from("#' + id + '-card", { y: 60, opacity: 0, duration: 0.5, ease: "power3.out" }, ' + start + ' + 0.12);',
          'tl.from("#' + id + '-hl", { scale: 0.6, opacity: 0, duration: 0.4, ease: "back.out(2)" }, ' + start + ' + 0.4);',
          'tl.from("#' + id + '-sum", { y: 20, opacity: 0, duration: 0.5 }, ' + start + ' + 0.6);'
        );
        (block.stats ?? []).forEach((_, si) => {
          tweens.push(
            'tl.from("#' + id + '-st' + si + '", { y: 16, opacity: 0, duration: 0.4 }, ' + start + ' + ' + (0.9 + si * 0.22) + ');'
          );
        });
        (block.points ?? []).forEach((_, pi) => {
          tweens.push(
            'tl.from("#' + id + '-pt' + pi + '", { x: -24, opacity: 0, duration: 0.4 }, ' + start + ' + ' + (1.4 + pi * 0.2) + ');'
          );
        });
        tweens.push(
          'tl.from("#' + id + '-u", { opacity: 0, duration: 0.4 }, ' + start + ' + ' + (1.4 + (block.points?.length ?? 0) * 0.2) + ');'
        );

        // ── 内嵌字幕条（画面元素，随主题配色；数据源 block.subtitle，缺失 fallback 旁白前 28 字）
        // 预渲染 div + opacity fromTo 控制窗口 —— 严禁 tween 中改 textContent（非 seek-safe）
        if (entry.audioDurationSec > 0) {
          const subText = (block.subtitle ?? "").trim() || (block.narration ?? "").slice(0, 28);
          if (subText) {
            const subId = compId + "-sub-" + entry.blockIndex;
            subtitleBars.push(
              '<div class="subtitle-bar" id="' + subId + '">' + esc(subText) + "</div>"
            );
            const hideAt = Math.max(Number(start) + entry.audioDurationSec - 0.3, Number(start) + 0.5).toFixed(2);
            tweens.push(
              'tl.fromTo("#' + subId + '", { opacity: 0 }, { opacity: 1, duration: 0.22 }, ' + start + ' + 0.5);',
              'tl.to("#' + subId + '", { opacity: 0, duration: 0.22 }, ' + hideAt + ');'
            );
          }
        }
        break;
      }
      default: {
        inner =
          '<div class="plain">' +
          '<h2 id="' + id + '-t">' + esc(block.content) + "</h2></div>";
        tweens.push(
          'tl.from("#' + id + '-t", { y: 40, opacity: 0, duration: 0.6, ease: "power3.out" }, ' + start + ' + 0.2);'
        );
      }
    }

    const compactInner = inner.replace(/\n\s*/g, " ").trim();
    sections.push(
      '  <section id="' + id + '" class="clip" data-start="' + start + '" data-duration="' + dur + '" data-track-index="' + track + '">' + compactInner + "\n  </section>"
    );
  }

  if (bgmSrc) {
    audios.push(
      '  <audio id="bgm" src="' + bgmSrc + '" data-start="0" data-duration="' + duration.toFixed(2) + '" data-track-index="11" data-volume="0.5"></audio>'
    );
  }

  const html = '<!doctype html>\n' +
    '<html lang="zh-CN">\n' +
    '  <head>\n' +
    '    <meta charset="UTF-8" />\n' +
    '    <meta name="viewport" content="width=' + W + ', height=' + H + '" />\n' +
    '    <title>' + esc(config.title) + '</title>\n' +
    '    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>\n' +
    '    <style>\n' +
    '      body { margin: 0; background: ' + T.bg + '; font-family: sans-serif; }\n' +
    '      #root { position: relative; width: ' + W + 'px; height: ' + H + 'px; overflow: hidden; background: ' + T.bg + '; }\n' +
    '      .bg { position: absolute; inset: 0; }\n' +
    '      .bg-grid { background-image: linear-gradient(' + T.border + '55 1px, transparent 1px), linear-gradient(90deg, ' + T.border + '55 1px, transparent 1px); background-size: 36px 36px; opacity: 0.6; }\n' +
    '      .bg-glow { background: radial-gradient(ellipse 70% 30% at 50% -5%, ' + T.glow + ', transparent 70%); }\n' +
    '      .clip { position: absolute; inset: 0; display: grid; place-items: center; padding: ' + px(40) + 'px ' + px(30) + 'px; }\n' +
    '      .hero { text-align: center; }\n' +
    '      .hero h1 { font-size: ' + px(76) + 'px; font-weight: 800; color: ' + T.text + '; margin: 0; letter-spacing: 3px; }\n' +
    '      .hero-sub { font-size: ' + px(28) + 'px; color: ' + T.muted + '; margin-top: ' + px(20) + 'px; letter-spacing: 1px; }\n' +
    '      .hero-line { width: ' + px(240) + 'px; height: 4px; border-radius: 2px; background: linear-gradient(90deg, transparent, ' + T.accent + ', transparent); margin: ' + px(30) + 'px auto 0; transform-origin: center; }\n' +
    '      .review { width: 100%; }\n' +
    '      .rev-title { font-size: ' + px(44) + 'px; font-weight: 800; color: ' + T.text + '; margin: 0 0 ' + px(26) + 'px; text-align: center; }\n' +
    '      .rev-item { display: flex; align-items: center; gap: ' + px(16) + 'px; background: ' + T.panel + '; border: 1px solid ' + T.border + '; border-radius: ' + px(14) + 'px; padding: ' + px(16) + 'px ' + px(20) + 'px; margin-bottom: ' + px(12) + 'px; }\n' +
    '      .rev-num { width: ' + px(38) + 'px; height: ' + px(38) + 'px; border-radius: 50%; background: ' + T.accentDark + '; color: ' + T.hlText + '; font-size: ' + px(20) + 'px; font-weight: 700; display: grid; place-items: center; flex-shrink: 0; }\n' +
    '      .rev-txt { font-size: ' + px(27) + 'px; color: ' + T.text + '; line-height: 1.4; }\n' +
    '      .rev-src { text-align: center; font-size: ' + px(20) + 'px; color: ' + T.muted + '; margin-top: ' + px(14) + 'px; letter-spacing: 2px; }\n' +
    '      .divider { text-align: center; }\n' +
    '      .divider h1 { font-size: ' + px(84) + 'px; font-weight: 800; color: ' + T.text + '; margin: 0; letter-spacing: 8px; }\n' +
    '      .div-line { width: ' + px(280) + 'px; height: 5px; border-radius: 3px; background: linear-gradient(90deg, transparent, ' + T.accent + ', transparent); margin: ' + px(32) + 'px auto 0; transform-origin: center; }\n' +
    '      .news-card { width: 100%; ' + (orientation === "long" ? "max-width: 1400px;" : "") + ' background: ' + T.panel + '; border: 1px solid ' + T.border + '; border-radius: ' + px(18) + 'px; padding: ' + px(26) + 'px ' + px(28) + 'px; display: flex; flex-direction: column; gap: ' + px(12) + 'px; max-height: 100%; overflow: hidden; }\n' +
    '      .nc-head { display: flex; justify-content: space-between; align-items: center; gap: ' + px(14) + 'px; }\n' +
    '      .nc-progress { font-size: ' + px(20) + 'px; color: ' + T.muted + '; font-weight: 600; }\n' +
    '      .nc-highlight { background: ' + T.accentDark + '; color: ' + T.hlText + '; font-size: ' + px(23) + 'px; font-weight: 700; padding: ' + px(8) + 'px ' + px(18) + 'px; border-radius: ' + px(24) + 'px; }\n' +
    '      .nc-title { font-size: ' + px(38) + 'px; font-weight: 800; color: ' + T.text + '; margin: 0; line-height: 1.25; }\n' +
    '      .nc-summary { font-size: ' + px(22) + 'px; color: ' + T.text + '; line-height: 1.5; background: ' + T.bg + '; border-radius: ' + px(10) + 'px; padding: ' + px(12) + 'px ' + px(16) + 'px; }\n' +
    '      .nc-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: ' + px(8) + 'px; }\n' +
    '      .st-card { background: ' + T.bg + '; border: 1px solid ' + T.border + '; border-radius: ' + px(10) + 'px; padding: ' + px(10) + 'px ' + px(12) + 'px; text-align: center; }\n' +
    '      .st-val { font-size: ' + px(26) + 'px; font-weight: 800; color: ' + T.accentDark + '; font-family: monospace; }\n' +
    '      .st-label { font-size: ' + px(15) + 'px; color: ' + T.muted + '; margin-top: ' + px(4) + 'px; }\n' +
    '      .nc-points { display: flex; flex-direction: column; gap: ' + px(6) + 'px; }\n' +
    '      .pt-item { display: flex; align-items: flex-start; gap: ' + px(9) + 'px; font-size: ' + px(21) + 'px; color: ' + T.text + '; line-height: 1.45; }\n' +
    '      .pt-dot { width: ' + px(7) + 'px; height: ' + px(7) + 'px; border-radius: 50%; background: ' + T.accent + '; flex-shrink: 0; margin-top: ' + px(10) + 'px; }\n' +
    '      .nc-meta { display: flex; gap: ' + px(14) + 'px; align-items: center; }\n' +
    '      .nc-src { font-size: ' + px(19) + 'px; color: ' + T.muted + '; }\n' +
    '      .nc-url { font-size: ' + px(17) + 'px; color: ' + T.accentDark + '; word-break: break-all; font-family: monospace; opacity: 0.95; }\n' +
    '      .plain { text-align: center; }\n' +
    '      .plain h2 { font-size: ' + px(44) + 'px; font-weight: 700; color: ' + T.text + '; margin: 0; line-height: 1.4; }\n' +
    '      .gprog { position: absolute; top: 0; left: 0; height: 6px; width: ' + W + 'px; background: ' + T.border + '; z-index: 50; }\n' +
    '      .gprog-fill { height: 100%; width: 0; background: ' + T.accent + '; border-radius: 0 3px 3px 0; }\n' +
    '      .footer { position: absolute; bottom: ' + px(18) + 'px; left: 0; right: 0; text-align: center; font-size: ' + px(17) + 'px; color: ' + T.muted + '; letter-spacing: 1px; z-index: 40; }\n' +
    // 内嵌字幕条：底部安全区上方，随主题配色（竖屏宽88%+底部8%安全区 / 横屏居中上限宽1200px）
    '      .subtitle-bar { position: absolute; left: 50%; transform: translateX(-50%); bottom: ' + px(72) + 'px; width: 88%; max-width: ' + (orientation === "long" ? 1200 : 880) + 'px; background: rgba(0,0,0,0.72); color: #fff; font-size: ' + px(24) + 'px; line-height: 1.4; text-align: center; padding: ' + px(10) + 'px ' + px(18) + 'px; border-radius: ' + px(10) + 'px; z-index: 45; opacity: 0; font-family: "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif; }\n' +
    '    </style>\n' +
    '  </head>\n' +
    '  <body>\n' +
    '    <div id="root" data-composition-id="' + compId + '" data-start="0" data-width="' + W + '" data-height="' + H + '" data-duration="' + duration.toFixed(2) + '" data-fps="' + fps + '">\n' +
    '      <div class="bg bg-grid"></div>\n' +
    '      <div class="bg bg-glow"></div>\n' +
    sections.join("\n") + "\n" +
    audios.join("\n") + "\n" +
    '      <div class="gprog"><div class="gprog-fill" id="' + compId + '-gprog"></div></div>\n' +
    subtitleBars.join("\n") + "\n" +
    '      <div class="footer">' + esc(config.footer ?? "") + '</div>\n' +
    '    </div>\n' +
    '    <script>\n' +
    '      window.__timelines = window.__timelines || {};\n' +
    '      const tl = gsap.timeline({ paused: true });\n' +
    tweens.map((t) => '      ' + t).join("\n") + "\n" +
    bgmTweens.map((t) => '      ' + t).join("\n") + "\n" +
    '      tl.fromTo("#' + compId + '-gprog", { width: 0 }, { width: ' + W + ', duration: ' + duration.toFixed(2) + ', ease: "none" }, 0);\n' +
    '      window.__timelines["' + compId + '"] = tl;\n' +
    '    </script>\n' +
    '  </body>\n' +
    '</html>\n';

  await mkdir(outDir, { recursive: true });
  const compactHtml = html.replace(/\n\s*\n+/g, "\n");
  const indexHtmlPath = path.join(outDir, "index.html");
  await writeFile(indexHtmlPath, compactHtml, "utf-8");

  return {
    runId: job.runId,
    compositionId: compId,
    orientation,
    indexHtmlPath,
    width: W,
    height: H,
    fps,
    durationSec: duration,
    blocks: config.blocks.length,
    audioCount: audios.length,
    bgmCopied: bgmCopied,
    voiceoverFiles,
  };
}

// ─────────────────────────── CLI ───────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };

  const runDirFlag = get("--run-dir", "");
  if (!runDirFlag) {
    console.error("[hyperframes] 必须提供 --run-dir（如 runs/2026-08-28/ai-news-morning）");
    process.exit(1);
  }
  const runDir = path.resolve(ROOT, runDirFlag);
  const date = path.basename(path.dirname(runDir));
  const runId = get("--run-id", path.basename(runDir) + (date && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) ? "-" + date : ""));
  const orientation = get("--orientation", "short") === "long" ? "long" : "short";

  const artifact = await generateHyperframes({
    runId,
    configPath: get("--config", path.join(runDir, "config", "content.json")),
    timelinePath: get("--timeline", path.join(runDir, "timeline", "timeline.json")),
    runDir,
    orientation,
    style: get("--style", ""),
    outputDir: get("--out", "") || undefined,
  });

  console.log(
    "[hyperframes] " + artifact.compositionId + " 生成 " + artifact.blocks + " 页 + " + artifact.audioCount + " 音轨，" +
      "总时长 " + artifact.durationSec.toFixed(1) + "s " + artifact.width + "x" + artifact.height + " @" + artifact.fps + "fps → " +
      path.relative(ROOT, artifact.indexHtmlPath)
  );
}

const isDirectRun =
  process.argv[1] &&
  (import.meta.url === new URL("file://" + path.resolve(process.argv[1])).href ||
    import.meta.url.endsWith("/" + path.basename(process.argv[1])));
if (isDirectRun) {
  main().catch((e) => {
    console.error("[hyperframes] 失败:", e);
    process.exit(1);
  });
}