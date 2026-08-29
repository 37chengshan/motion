/**
 * 整视频审查（§6.1/§6.2 重构版）— ReviewProvider 接口
 *
 * Providers：
 *   agy   AgyReviewProvider：锁定版本 agy --print 完整视频理解（首选）
 *   watch ClaudeVideoWatchProvider：只调用 skills.lock.json 中已安装 watch skill 的
 *         文档化入口（WATCH_CLI 环境变量显式指定，或 entry_path 解析为可执行文件）；
 *         禁止猜测不存在的 watch CLI。
 *
 * 报告 schema（§6.2）：
 *   status: "completed" | "error"
 *   verdict: "pass" | "warning" | "fail" | "unknown"
 *   issues[]: { timestamp_sec, severity, location, description, suggestion }
 *   summary, model, provider, reviewed_at, video, timeline_hash, config_hash
 *   status=error 时必须带 provider_error
 *
 * 门：provider 不可用 / 返回非零 / 输出无法解析 / 证据不完整 → status=error，
 *     绝不降级为 pass。verdict=fail 或 status=error 时退出码 1。
 * 跨平台 sleep：Node setTimeout（Windows/macOS/Linux 一致）。
 *
 * 用法：
 *   node scripts/review-video.ts <video> [--kind render|repost] [--effort high] \
 *     [--config ...] [--timeline ...] [--out report.json] [--provider agy|watch|all]
 */
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();

export type ReviewVerdict = "pass" | "warning" | "fail" | "unknown";
export type IssueSeverity = "high" | "medium" | "low";

export interface ReviewIssue {
  timestamp_sec: number;
  severity: IssueSeverity;
  location: string;
  description: string;
  suggestion: string;
}

export interface ReviewReport {
  status: "completed" | "error";
  verdict: ReviewVerdict;
  issues: ReviewIssue[];
  summary: string;
  model: string;
  provider: string;
  reviewed_at: string;
  video: string;
  timeline_hash?: string;
  config_hash?: string;
  provider_error?: string;
  kind: "render" | "repost";
  domain?: string;
  copyrightRisk?: string;
}

export interface ReviewRequest {
  video: string;
  kind: "render" | "repost";
  effort: "low" | "medium" | "high";
  configPath?: string;
  timelinePath?: string;
}

export interface ReviewProvider {
  name: string;
  available(): Promise<{ ok: boolean; reason?: string }>;
  review(req: ReviewRequest): Promise<ReviewReport>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const sha256File = async (p: string): Promise<string | undefined> => {
  try {
    return createHash("sha256").update(await readFile(p)).digest("hex");
  } catch {
    return undefined;
  }
};

function parseReportJson(raw: string): Record<string, unknown> | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeIssues(raw: unknown): ReviewIssue[] | null {
  if (!Array.isArray(raw)) return null;
  const issues: ReviewIssue[] = [];
  for (const it of raw) {
    const o = it as Record<string, unknown>;
    const ts = typeof o.timestamp_sec === "number" ? (o.timestamp_sec as number) : typeof o.timestampSec === "number" ? (o.timestampSec as number) : NaN;
    if (!Number.isFinite(ts)) return null;
    const sev = String(o.severity ?? "low");
    if (!["high", "medium", "low"].includes(sev)) return null;
    issues.push({
      timestamp_sec: ts,
      severity: sev as IssueSeverity,
      location: String(o.location ?? ""),
      description: String(o.description ?? ""),
      suggestion: String(o.suggestion ?? ""),
    });
  }
  return issues;
}

// ─────────────────────────── Agy provider ───────────────────────────

class AgyReviewProvider implements ReviewProvider {
  name = "agy";

  async available(): Promise<{ ok: boolean; reason?: string }> {
    return { ok: true };
  }

  private async prompt(req: ReviewRequest): Promise<string> {
    const videoAbs = path.resolve(ROOT, req.video);
    if (req.kind === "repost") {
      return [
        "你是视频搬运合规审查员，将完整观看一个待发布的视频。视频文件：@" + videoAbs,
        "",
        "【检查清单】逐项检查，问题必须带时间戳（秒）：",
        "1. 版权素材识别（high 优先）：背景音乐、影视/动漫片段、新闻台标、他人水印/logo 常驻",
        "2. 敏感内容：暴力/血腥/色情/政治敏感/危险行为教学",
        "3. 平台违规：画面内违规词、引流二维码/联系方式/诱导话术",
        "4. 内容理解：一句话主题摘要",
        "",
        '【输出契约】严格只输出一个 JSON 对象：',
        '{"verdict":"pass|warning|fail","issues":[{"timestampSec":<秒数int>,"severity":"high|medium|low","location":"<位置>","description":"<问题>","suggestion":"<建议>"}],"summary":"<摘要>","domain":"<领域>","copyrightRisk":"high|medium|low"}',
        "无风险才 pass；版权 high 或敏感 → fail；低置信版权嫌疑 → warning。",
      ].join("\n");
    }
    let dataSnapshot = "（未提供）";
    try {
      const config = JSON.parse(await readFile(path.resolve(ROOT, req.configPath ?? ""), "utf-8"));
      const nums: string[] = [];
      for (const b of config.blocks ?? []) {
        const parts: string[] = [];
        if (b.highlight) parts.push(b.highlight);
        for (const s of b.stats ?? []) parts.push(s.label + "=" + s.value);
        if (parts.length) nums.push("[" + (b.content ?? "").slice(0, 30) + "]: " + parts.join(" / "));
      }
      if (nums.length) dataSnapshot = nums.join("\n");
    } catch {
      /* 无 config 也允许 */
    }
    let timelineTable = "（未提供）";
    try {
      const tl = JSON.parse(await readFile(path.resolve(ROOT, req.timelinePath ?? ""), "utf-8"));
      const rows: string[] = [];
      for (const e of tl.entries ?? []) {
        rows.push(e.blockIndex + ": " + (e.globalStartSec ?? 0).toFixed(1) + "s 起（音频 " + (e.audioDurationSec ?? 0).toFixed(1) + "s）");
      }
      if (rows.length) timelineTable = rows.join("\n");
    } catch {
      /* 无 timeline 也允许 */
    }
    return [
      "你是视频成片质检员，将完整观看一个 AI 生成的新闻日报视频。视频文件：@" + videoAbs,
      "",
      "【预期数据快照】画面上出现的数字应与之相符：",
      dataSnapshot,
      "",
      "【预期时间轴段落表】每段画面内容应与该时间段对应：",
      timelineTable,
      "",
      "【检查清单】逐项检查，问题必须带时间戳（秒）：",
      "1. 数据核对：每个数字与数据快照比对，不一致标 high",
      "2. 文字质检：溢出/截断/乱码/字号过小不可读，标画面位置",
      "3. 动画质检：入场未完成、异常长静止、黑帧/白帧/花屏/空白占位",
      "4. 时序对照：画面与时间轴段落错位",
      "5. 品质项：模糊帧、素材拉伸变形、比例异常",
      "",
      "【输出契约】严格只输出一个 JSON 对象：",
      '{"verdict":"pass|warning|fail","issues":[{"timestampSec":<秒数int>,"severity":"high|medium|low","location":"<画面位置>","description":"<问题描述>","suggestion":"<修复建议>"}],"summary":"<总体评价一句话>"}',
      "无任何问题才 pass 且 issues=[]；轻微瑕疵 warning；数字错误/文字溢出/黑帧等必现问题 fail。",
    ].join("\n");
  }

  async review(req: ReviewRequest): Promise<ReviewReport> {
    const videoAbs = path.resolve(ROOT, req.video);
    const prompt = await this.prompt(req);
    const models = {
      high: ["gemini-3.7-flash-high", "gemini-3.7-flash-medium", "gemini-3.7-flash-low"],
      medium: ["gemini-3.7-flash-medium", "gemini-3.7-flash-low"],
      low: ["gemini-3.7-flash-low"],
    }[req.effort];

    let lastErr = "";
    for (const model of models) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const { code, stdout, stderr } = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
          const child = spawn("agy", ["--model", model, "--print-timeout", "600s", "--print", prompt], { shell: false });
          let out = "";
          let err = "";
          child.stdout.on("data", (d) => (out += d.toString()));
          child.stderr.on("data", (d) => (err += d.toString()));
          child.on("close", (c) => resolve({ code: c, stdout: out, stderr: err }));
        });
        const retryable = /resource exhausted|429|rate limit|quota|stream was interrupted|stream interrupted/i.test(stderr);
        if (retryable && attempt < 3) {
          lastErr = stderr;
          console.warn("[review] " + model + " 限流/流中断，10s 后重试…");
          await sleep(10_000);
          continue;
        }
        if (code !== 0) {
          lastErr = stderr || "agy exit " + code;
          break;
        }
        const parsed = parseReportJson(stdout);
        if (!parsed) {
          lastErr = "输出非 JSON：" + stdout.slice(0, 400);
          break;
        }
        const issues = normalizeIssues(parsed.issues);
        if (!issues) {
          lastErr = "issues 结构不完整（缺少 timestampSec/severity/description/suggestion）";
          break;
        }
        const verdict = (["pass", "warning", "fail"].includes(String(parsed.verdict)) ? parsed.verdict : "unknown") as ReviewVerdict;
        return {
          status: "completed",
          verdict,
          issues,
          summary: String(parsed.summary ?? ""),
          model,
          provider: "agy",
          reviewed_at: new Date().toISOString(),
          video: path.relative(ROOT, videoAbs),
          timeline_hash: req.timelinePath ? await sha256File(path.resolve(ROOT, req.timelinePath)) : undefined,
          config_hash: req.configPath ? await sha256File(path.resolve(ROOT, req.configPath)) : undefined,
          kind: req.kind,
          domain: req.kind === "repost" ? String(parsed.domain ?? "") : undefined,
          copyrightRisk: req.kind === "repost" ? String(parsed.copyrightRisk ?? "") : undefined,
        };
      }
    }
    return {
      status: "error",
      verdict: "unknown",
      issues: [],
      summary: "",
      model: "agy",
      provider: "agy",
      reviewed_at: new Date().toISOString(),
      video: path.relative(ROOT, videoAbs),
      provider_error: "agy 全部失败：" + (lastErr || "未知错误").slice(0, 500),
      kind: req.kind,
    };
  }
}

// ─────────────────────────── Watch provider ───────────────────────────

class ClaudeVideoWatchProvider implements ReviewProvider {
  name = "watch";

  private entry(): { cli: string; reason?: string } {
    const cliEnv = process.env.WATCH_CLI;
    if (cliEnv) return { cli: cliEnv };
    try {
      const lockPath = path.resolve(ROOT, "..", "skills.lock.json");
      const lock = JSON.parse(readFileSync(lockPath, "utf-8")) as {
        skills: { skill: string; entry_path?: string }[];
      };
      const watch = lock.skills?.find((s) => s.skill === "watch");
      if (!watch) return { cli: "", reason: "skills.lock.json 未锁定 watch skill" };
      const skillDir = path.resolve(ROOT, "..", ".agents", "skills", "watch");
      const entryPath = watch.entry_path ? path.resolve(skillDir, watch.entry_path) : "";
      if (entryPath && existsSync(entryPath)) return { cli: entryPath };
      return { cli: "", reason: "watch skill 无可执行入口（entry_path=" + (watch.entry_path ?? "?") + "）；请用 WATCH_CLI 显式配置" };
    } catch {
      return { cli: "", reason: "无法读取 skills.lock.json" };
    }
  }

  async available(): Promise<{ ok: boolean; reason?: string }> {
    const e = this.entry();
    return e.cli ? { ok: true } : { ok: false, reason: e.reason };
  }

  async review(req: ReviewRequest): Promise<ReviewReport> {
    const e = this.entry();
    const videoAbs = path.resolve(ROOT, req.video);
    const { code, stdout, stderr } = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(e.cli, [videoAbs], { shell: false });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d.toString()));
      child.stderr.on("data", (d) => (err += d.toString()));
      child.on("close", (c) => resolve({ code: c, stdout: out, stderr: err }));
    });
    if (code !== 0) {
      return { status: "error", verdict: "unknown", issues: [], summary: "", model: "watch", provider: "watch", reviewed_at: new Date().toISOString(), video: path.relative(ROOT, videoAbs), provider_error: ("watch 退出 " + code + "：" + stderr).slice(0, 500), kind: req.kind };
    }
    const parsed = parseReportJson(stdout);
    const issues = parsed ? normalizeIssues(parsed.issues) : null;
    if (!parsed || !issues) {
      return { status: "error", verdict: "unknown", issues: [], summary: "", model: "watch", provider: "watch", reviewed_at: new Date().toISOString(), video: path.relative(ROOT, videoAbs), provider_error: "watch 输出无法解析或证据不完整", kind: req.kind };
    }
    return {
      status: "completed",
      verdict: (["pass", "warning", "fail"].includes(String(parsed.verdict)) ? parsed.verdict : "unknown") as ReviewVerdict,
      issues,
      summary: String(parsed.summary ?? ""),
      model: "watch",
      provider: "watch",
      reviewed_at: new Date().toISOString(),
      video: path.relative(ROOT, videoAbs),
      timeline_hash: req.timelinePath ? await sha256File(path.resolve(ROOT, req.timelinePath)) : undefined,
      config_hash: req.configPath ? await sha256File(path.resolve(ROOT, req.configPath)) : undefined,
      kind: req.kind,
    };
  }
}

export function createProviders(): ReviewProvider[] {
  return [new AgyReviewProvider(), new ClaudeVideoWatchProvider()];
}

// ─────────────────────────── CLI ───────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const video = args.find((a) => !a.startsWith("--") && !a.startsWith("-"));
  if (!video) {
    console.error("[review] 用法：node scripts/review-video.ts <视频> [--kind render|repost] [--effort] [--config] [--timeline] [--out] [--provider agy|watch|all]");
    process.exit(1);
  }
  const videoAbs = path.resolve(ROOT, video);
  if (!existsSync(videoAbs)) {
    console.error("[review] 视频不存在：" + video);
    process.exit(1);
  }
  const req: ReviewRequest = {
    video,
    kind: get("--kind", "render") === "repost" ? "repost" : "render",
    effort: (["low", "medium", "high"] as const).includes(get("--effort", "") as never) ? (get("--effort", "high") as ReviewRequest["effort"]) : "high",
    configPath: get("--config", "") || undefined,
    timelinePath: get("--timeline", "") || undefined,
  };
  const providerFlag = get("--provider", "all");
  const providers = createProviders().filter((p) => providerFlag === "all" || p.name === providerFlag);

  let report: ReviewReport | null = null;
  for (const provider of providers) {
    const avail = await provider.available();
    if (!avail.ok) {
      console.warn("[review] provider " + provider.name + " 不可用：" + (avail.reason ?? "?"));
      continue;
    }
    console.log("[review] " + provider.name + " 审查：" + path.basename(videoAbs) + "…");
    const r = await provider.review(req);
    report = r;
    break; // 运行即定格：completed 或 error 都不得继续降级
  }
  if (!report) {
    report = {
      status: "error", verdict: "unknown", issues: [], summary: "", model: "none", provider: "none",
      reviewed_at: new Date().toISOString(), video: path.relative(ROOT, videoAbs),
      provider_error: "无可用 provider（agy 不可用且 watch 未配置）", kind: req.kind,
    };
  }

  const outPath = path.resolve(ROOT, get("--out", path.join(path.dirname(videoAbs), "review-report.json")));
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(report, null, 2), "utf-8");

  console.log("[review] provider=" + report.provider + " status=" + report.status + " verdict=" + report.verdict + " issues=" + report.issues.length + " → " + path.relative(ROOT, outPath));
  if (report.status === "error") console.error("[review] provider_error: " + (report.provider_error ?? ""));
  if (report.status === "error" || report.verdict === "fail") process.exit(1);
}

const isDirectRun =
  process.argv[1] &&
  (import.meta.url === new URL("file://" + path.resolve(process.argv[1])).href ||
    import.meta.url.endsWith("/" + path.basename(process.argv[1])));
if (isDirectRun) {
  main().catch((e) => {
    console.error("[review] 失败:", e);
    process.exit(1);
  });
}