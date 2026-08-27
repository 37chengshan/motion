/**
 * 整视频审查 — 通过本机 agy CLI（Antigravity，Gemini Agent CLI）把完整视频交给
 * gemini-3.7-flash 理解，替代"抽 6 帧"的丢细节审查。
 *
 * 原理：agy --print "提示词 @<视频绝对路径>"，视频由模型原生理解（Gemini 原生多模态，
 * 服务端 1fps 采样 + 时间轴原生对齐），无需本地拆帧。
 *
 * 用法：
 *   npm run review:video -- out/ai_news_short.mp4 --kind render [--effort high] [--config src/data/today.json] [--timeline out/timeline.json]
 *   npm run review:video -- repost/inbox/<id>/<video>.mp4 --kind repost [--effort low]
 *
 * 输出：out/review-report.json（render）或 repost/inbox/<id>/review-report.json（repost）
 * verdict=fail 时退出码 1（流程闸口用）。
 */
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd(); // vido/

interface ReviewArgs {
  video: string;
  kind: "render" | "repost";
  effort: "low" | "medium" | "high";
  config: string;
  timeline: string;
  domains: string[];
}

function parseArgs(argv: string[]): ReviewArgs {
  const get = (flag: string, fallback: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const video = argv.find((a) => !a.startsWith("--") && !a.startsWith("-"));
  if (!video) {
    console.error("[review] 用法：npm run review:video -- <视频路径> [--kind render|repost] [--effort low|medium|high] [--config ...] [--timeline ...]");
    process.exit(1);
  }
  return {
    video,
    kind: get("--kind", "render") === "repost" ? "repost" : "render",
    effort: (["low", "medium", "high"] as const).includes(get("--effort", "") as never)
      ? (get("--effort", "high") as ReviewArgs["effort"])
      : "high",
    config: get("--config", "src/data/today.json"),
    timeline: get("--timeline", "out/timeline.json"),
    domains: [],
  };
}

/** render 审查提示词：数据核对 + 文字质检 + 动画质检 + 时序对照 */
function renderPrompt(videoAbs: string, configPath: string, timelinePath: string): string {
  // 数据快照：从 today.json 提取所有关键数字（stats/highlight）
  let dataSnapshot = "（未提供）";
  try {
    const config = JSON.parse(readFileSyncSafe(path.resolve(ROOT, configPath)) ?? "{}");
    const nums: string[] = [];
    for (const b of config.blocks ?? []) {
      const parts: string[] = [];
      if (b.highlight) parts.push(b.highlight);
      for (const s of b.stats ?? []) parts.push(`${s.label}=${s.value}`);
      if (parts.length) nums.push(`[${b.content?.slice(0, 30) ?? ""}]: ${parts.join(" / ")}`);
    }
    if (nums.length) dataSnapshot = nums.join("\n");
  } catch {
    /* 无 config 也允许 */
  }
  // timeline 段落表
  let timelineTable = "（未提供）";
  try {
    const tl = JSON.parse(readFileSyncSafe(path.resolve(ROOT, timelinePath)) ?? "{}");
    const rows: string[] = [];
    for (const e of tl.entries ?? []) {
      rows.push(`${e.blockIndex}: ${e.globalStartSec?.toFixed(1) ?? "?"}s 起（音频 ${e.audioDurationSec?.toFixed(1) ?? "?"}s）`);
    }
    if (rows.length) timelineTable = rows.join("\n");
  } catch {
    /* 无 timeline 也允许 */
  }

  return `你是视频成片质检员，将完整观看一个 AI 生成的新闻日报视频（从头到尾，不要跳过任何片段）。视频文件：@${videoAbs}

【预期数据快照】画面上出现的数字应与之相符：
${dataSnapshot}

【预期时间轴段落表】每段画面内容应与该时间段对应：
${timelineTable}

【检查清单】逐项检查，问题必须带时间戳（秒）：
1. 数据核对：画面上每个数字（star 数/百分比/金额/日期）与数据快照逐一比对，不一致的标 high
2. 文字质检：溢出/截断/换行错误/乱码/字号过小不可读，标出画面位置（顶部/中部/底部/左侧/右侧）
3. 动画质检：入场动画未完成、画面异常长时间静止（非设计性静置）、黑帧/白帧/花屏/空白占位
4. 时序对照：画面内容与时间轴段落表错位（画面标题与该时间戳应有段落不符）
5. 品质项：模糊帧、素材拉伸变形、比例异常

【输出契约】严格只输出一个 JSON 对象，不要任何其他文字或 markdown 代码块：
{"verdict":"pass|warning|fail","issues":[{"timestampSec":<秒数int>,"severity":"high|medium|low","location":"<画面位置>","description":"<问题描述>","suggestion":"<修复建议>"}],"summary":"<总体评价一句话>"}
规则：无任何问题才 verdict=pass 且 issues=[]；轻微瑕疵 warning；数字错误/文字溢出/黑帧等必现问题 fail。`;
}

/** repost 审查提示词：版权 + 敏感 + 违规 + 内容摘要 */
function repostPrompt(videoAbs: string): string {
  return `你是视频搬运合规审查员，将完整观看一个待发布的视频（从头到尾，不要跳过任何片段）。视频文件：@${videoAbs}

【检查清单】逐项检查，问题必须带时间戳（秒）：
1. 版权素材识别（high 优先）：背景音乐（是否知名歌曲/有无音乐 App 界面或 MV 画面）、影视/动漫片段、新闻台标画面、其他创作者的水印/logo 常驻
2. 敏感内容：暴力/血腥/色情/政治敏感/危险行为教学
3. 平台违规：画面内文字的违规词、引流二维码/联系方式/诱导话术
4. 内容理解：这 60 秒内容讲了什么主题（一句话摘要）

【输出契约】严格只输出一个 JSON 对象，不要任何其他文字或 markdown 代码块：
{"verdict":"pass|warning|fail","issues":[{"timestampSec":<秒数int>,"severity":"high|medium|low","location":"<画面位置>","description":"<问题描述>","suggestion":"<建议>"}],"summary":"<60字内内容摘要>","domain":"<内容领域：AI|编程|数码|科普|财经|影视|游戏|生活|其他>","copyrightRisk":"high|medium|low"}
规则：无风险才 verdict=pass；版权风险 high 或敏感内容 → fail；有轻微风险（如低置信度版权嫌疑）→ warning 并说明。`;
}

function readFileSyncSafe(p: string): string | null {
  try {
    return require("node:fs").readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

/** 模型链：仅 gemini-3.7-flash 三档（429/流中断时同档重试后降档） */
function modelChain(effort: ReviewArgs["effort"]): string[] {
  const base: Record<ReviewArgs["effort"], string[]> = {
    high: ["gemini-3.7-flash-high", "gemini-3.7-flash-medium", "gemini-3.7-flash-low"],
    medium: ["gemini-3.7-flash-medium", "gemini-3.7-flash-low"],
    low: ["gemini-3.7-flash-low"],
  };
  return base[effort];
}

/** 调用 agy：按降级链逐个模型尝试；429/流中断视为可重试，单模型最多 3 次（间隔 10s） */
function runAgy(effort: ReviewArgs["effort"], prompt: string): { status: number; stdout: string; stderr: string; usedModel: string } {
  const models = modelChain(effort);
  let lastErr = "";
  for (const model of models) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = spawnSync(
        "agy",
        ["--model", model, "--print-timeout", "600s", "--print", prompt],
        { encoding: "utf-8", shell: false, timeout: 11 * 60 * 1000 }
      );
      const out = (r.stdout ?? "").trim();
      const err = (r.stderr ?? "").trim();
      const retryable = /resource exhausted|429|rate limit|quota|stream was interrupted|stream interrupted/i.test(err);
      if (retryable) {
        lastErr = err;
        console.warn(`[review] ${model} ${/resource exhausted|429|rate limit|quota/i.test(err) ? "限流" : "流中断"}，${attempt === 3 ? "换下一个模型" : "10s 后重试"}…`);
        spawnSync("cmd", ["/c", "timeout /t 10 /nobreak >nul"], { stdio: "ignore", shell: false });
        continue;
      }
      return { status: r.status ?? 1, stdout: out, stderr: err, usedModel: model };
    }
  }
  return { status: 1, stdout: "", stderr: `全部模型失败：${lastErr.slice(0, 300)}`, usedModel: models[models.length - 1] };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const videoAbs = path.resolve(ROOT, args.video);
  if (!existsSync(videoAbs)) {
    console.error(`[review] 视频不存在：${args.video}`);
    process.exit(1);
  }

  const prompt = args.kind === "render" ? renderPrompt(videoAbs, args.config, args.timeline) : repostPrompt(videoAbs);

  console.log(`[review] ${args.kind} 审查：${path.basename(videoAbs)}（${args.effort} 档起，完整视频理解）…`);

  const r = runAgy(args.effort, prompt);

  const stdout = r.stdout;
  const stderr = r.stderr;
  if (r.status !== 0) {
    console.error(`[review] agy 调用失败：${stderr.slice(0, 500)}`);
    console.error(`[review] stdout 片段：${stdout.slice(0, 500)}`);
    process.exit(1);
  }

  // 解析 JSON（agy 可能带 markdown 包裹或前导说明，剥壳）
  const jsonMatch = stdout.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error(`[review] 输出非 JSON：${stdout.slice(0, 1000)}`);
    process.exit(1);
  }
  let report: Record<string, unknown>;
  try {
    report = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error(`[review] JSON 解析失败：${e}\n${stdout.slice(0, 1000)}`);
    process.exit(1);
  }

  report = { ...report, reviewedAt: new Date().toISOString(), video: path.relative(ROOT, videoAbs), model: r.usedModel, kind: args.kind };

  // 输出路径
  let outPath: string;
  if (args.kind === "repost") {
    const inboxDir = path.dirname(videoAbs);
    outPath = path.join(inboxDir, "review-report.json");
  } else {
    outPath = path.join(ROOT, "out", "review-report.json");
  }
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(report, null, 2), "utf-8");

  const verdict = String(report.verdict ?? "unknown");
  console.log(`[review] verdict=${verdict}，issues=${Array.isArray(report.issues) ? report.issues.length : 0} → ${path.relative(ROOT, outPath)}`);
  if (Array.isArray(report.issues)) {
    for (const i of report.issues.slice(0, 10)) {
      console.log(`  [${i.severity}] ${i.timestampSec}s ${i.location ?? ""}: ${i.description}`);
    }
  }
  if (verdict === "fail") process.exit(1);
}

main().catch((e) => {
  console.error("[review] 失败:", e);
  process.exit(1);
});
