/**
 * 周更流水线（§5.3/§5.4）
 *
 * 节奏：周六生成/审查，周日进入发布队列（--force 可绕过日期门，仅测试用）。
 * 每周两个 run：
 *   weekly-github-<slug>    GitHub 精品（实时 GitHub API/README 事实）
 *   weekly-own-<slug>       自有项目（weekly/own-project.json 显式资料，不用 GitHub 统计填充）
 * 每个 run 先生成 video-spec.md / storyboard.md（§5.4：video-spec-builder + video-agency-roles 的分镜种子，
 *   由 motion-design 映射到 Remotion 组件；脚本只生成结构化种子，正典规则在 .agents/skills）。
 * 媒体门（§5.6）：own-project 品牌素材 import 重算 SHA-256；默认图片模型 probe 失败 → needs_asset 停止。
 *
 * 用法：
 *   node scripts/weekly-pipeline.ts --date 2026-08-28 \
 *     --github-url https://github.com/owner/repo [--own-project weekly/own-project.json] [--force] [--no-media]
 */
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { createHash } from "node:crypto";
import { markStageDone } from "./stage.ts";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

async function runScript(script: string, args: string[]): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [script, ...args], {
      cwd: ROOT,
      env: process.env as NodeJS.ProcessEnv,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: ((err.stdout ?? "") + "\n" + (err.stderr ?? "")).trim() || (err.message ?? "unknown") };
  }
}

const sha256File = async (p: string): Promise<string> =>
  createHash("sha256").update(await readFile(p)).digest("hex");

/** §5.4 分镜种子（视频规格 + 分镜表） */
async function writeSpecs(runDir: string, cfg: { title: string; subtitle?: string; type: string; blocks: { type: string; content: string; summary?: string; points?: string[]; section?: string; narration?: string }[] }): Promise<void> {
  const spec: string[] = [
    "# video-spec",
    "",
    "- 标题：" + cfg.title,
    "- 副标题：" + (cfg.subtitle ?? ""),
    "- 类型：" + cfg.type,
    "- 引擎：Remotion（VidoShort/VidoLong，RenderJobProps 驱动）",
    "- 分镜种子：由本脚本生成，人工/video-spec-builder 精化；动效规则由 motion-design skill 映射到 Remotion 组件",
    "",
    "## 平台版本",
    "",
    "| 平台 | 画幅 | 组合 | 输出 |",
    "|---|---|---|---|",
    "| 短视频（抖音/小红书/视频号） | 9:16 | VidoShort | renders/short.mp4 |",
    "| 长视频（B站/YouTube） | 16:9 | VidoLong | renders/long.mp4 |",
    "",
    "## 节拍（来自 config blocks，时长由 timeline 决定）",
    "",
  ];
  cfg.blocks.forEach((b, i) => {
    spec.push("- 镜头 " + (i + 1) + " [" + (b.section ?? "hook") + "]：" + b.content + (b.narration ? "（旁白：" + b.narration + "）" : ""));
  });
  spec.push("", "## 信息载荷与素材清单", "", "- 事实/数字均带来源 URL + 快照 hash（见 config.sourceRefs）", "- 品牌素材/生成图：media/media-manifest.json", "- CTA：" + (cfg.blocks[cfg.blocks.length - 1]?.content ?? ""));

  const story: string[] = [
    "# storyboard",
    "",
    "| # | 时间 | 画面 | 信息载荷 | 素材 | 动效建议（motion-design 映射） |",
    "|---|------|------|---------|------|------|",
  ];
  cfg.blocks.forEach((b, i) => {
    story.push("| " + (i + 1) + " | t" + i + " | " + b.content.replace(/\|/g, "/") + " | " + (b.points?.slice(0, 3).join("；") ?? b.summary ?? "") + " | " + (b.type === "image" ? "品牌素材" : "文字卡") + " | 入场 fade/slide（具体规则见 motion-design skill） |");
  });

  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, "video-spec.md"), spec.join("\n"), "utf-8");
  await writeFile(path.join(runDir, "storyboard.md"), story.join("\n"), "utf-8");
}

/** 读 config 供 specs 使用 */
async function loadConfig(runDir: string): Promise<{ title: string; subtitle?: string; type: string; blocks: { type: string; content: string; summary?: string; points?: string[]; section?: string; narration?: string }[] }> {
  const cfg = JSON.parse(await readFile(path.join(runDir, "config", "content.json"), "utf-8"));
  return { title: cfg.title, subtitle: cfg.subtitle, type: cfg.type, blocks: cfg.blocks ?? [] };
}

/** 从 --github-url 固定快照并生成单仓库 selection（离线时使用已预置快照） */
async function prepareGithubSelection(runDir: string, fullName: string, fetchEnabled: boolean): Promise<{ ok: boolean; error?: string }> {
  const [owner, repo] = fullName.split("/");
  const snapDir = path.join(runDir, "research", "snapshots");
  const apiPath = path.join(snapDir, owner + "__" + repo + ".api.json");
  const readmePath = path.join(snapDir, owner + "__" + repo + ".readme.md");
  if (!existsSync(apiPath) || !existsSync(readmePath)) {
    if (!fetchEnabled) {
      return { ok: false, error: "缺少快照（加 --fetch 在线抓取，或预置 " + path.relative(ROOT, snapDir) + "）" };
    }
    const fetchText = async (url: string) => {
      const headers: Record<string, string> = { "User-Agent": "vido-weekly" };
      if (process.env.GITHUB_TOKEN) headers.Authorization = "Bearer " + process.env.GITHUB_TOKEN;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.text();
    };
    await mkdir(snapDir, { recursive: true });
    await writeFile(apiPath, await fetchText("https://api.github.com/repos/" + fullName), "utf-8");
    await writeFile(readmePath, await fetchText("https://raw.githubusercontent.com/" + fullName + "/HEAD/README.md"), "utf-8");
  }
  const selection = {
    date: path.basename(path.dirname(runDir)),
    selected_by: "weekly-pipeline",
    selected_at: new Date().toISOString(),
    repos: [{
      full_name: fullName,
      url: "https://github.com/" + fullName,
      api_snapshot_sha256: await sha256File(apiPath),
      readme_snapshot_sha256: await sha256File(readmePath),
      rationale: "weekly featured",
    }],
  };
  await mkdir(path.dirname(path.join(runDir, "selection.json")), { recursive: true });
  await writeFile(path.join(runDir, "selection.json"), JSON.stringify(selection, null, 2), "utf-8");
  return { ok: true };
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const has = (flag: string) => args.includes(flag);

  const date = get("--date", "");
  if (!DATE_RE.test(date)) {
    console.error("[weekly] 必须提供 --date YYYY-MM-DD");
    process.exit(1);
  }
  const force = has("--force");
  const fetchEnabled = has("--fetch");
  const noMedia = has("--no-media");

  // 周六生成 / 周日入队（PRODUCER_TIMEZONE）
  if (!force) {
    const tz = process.env.PRODUCER_TIMEZONE ?? "Asia/Shanghai";
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date(date + "T12:00:00Z"));
    if (weekday === "Sat") {
      console.log("[weekly] 周六：生成/审查");
    } else if (weekday === "Sun") {
      console.log("[weekly] 周日：进入发布队列（跳过生成，除非 --force）");
      const queue = {
        date,
        generated: false,
        note: "周日发布时间由 package target schedule 字段指定；运行 create-package 后由 Mac/Cloud 侧执行",
        runs: [] as { runId: string; runDir: string }[],
      };
      await mkdir(path.join(ROOT, "runs", date), { recursive: true });
      await writeFile(path.join(ROOT, "runs", date, "weekly-queue.json"), JSON.stringify(queue, null, 2), "utf-8");
      console.log("[weekly] 已写入 runs/" + date + "/weekly-queue.json");
      return;
    } else {
      console.error("[weekly] 非周六/周日（" + weekday + "），需 --force 才生成");
      process.exit(1);
    }
  }

  const failures: string[] = [];

  // ── run 1：GitHub 精品 ──
  const githubUrl = get("--github-url", "");
  if (githubUrl) {
    const m = /github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/.exec(githubUrl);
    if (!m || !REPO_RE.test(m[1])) {
      failures.push("--github-url 无法解析仓库名：" + githubUrl);
    } else {
      const fullName = m[1];
      const slug = fullName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const runDir = path.join(ROOT, "runs", date, "weekly-github-" + slug);
      const prep = await prepareGithubSelection(runDir, fullName, fetchEnabled);
      if (!prep.ok) {
        failures.push("weekly-github-" + slug + "：" + prep.error);
      } else {
        const r = await runScript("scripts/generate-github-config.ts", [
          "--run-dir", path.relative(ROOT, runDir), "--kind", "github-weekly", "--date", date,
          "--selection", path.relative(ROOT, path.join(runDir, "selection.json")),
          "--snapshot-dir", path.relative(ROOT, path.join(runDir, "research", "snapshots")),
        ]);
        if (r.ok) {
          await writeSpecs(runDir, await loadConfig(runDir));
          await markStageDone("weekly-github-" + slug + "-" + date, "script", { outputs: ["config/content.json", "video-spec.md", "storyboard.md"] });
          console.log("[weekly] weekly-github-" + slug + " ✓（video-spec/storyboard 已生成）");
        } else {
          failures.push("weekly-github-" + slug + "：" + r.output.split("\n").slice(-2).join(" | "));
        }
      }
    }
  }

  // ── run 2：自有项目 ──
  const ownFlag = get("--own-project", "");
  if (ownFlag) {
    const ownPath = path.resolve(ROOT, ownFlag);
    if (!existsSync(ownPath)) {
      failures.push("own-project.json 不存在：" + ownFlag);
    } else {
      const input = JSON.parse(await readFile(ownPath, "utf-8")) as { slug?: string; name?: string; brandAssets?: { path: string }[] };
      const slug = (input.slug ?? input.name ?? "own").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const runDir = path.join(ROOT, "runs", date, "weekly-own-" + slug);

      // 媒体门（§5.6）：品牌素材 import 重算 hash；默认图片模型 probe
      if (!noMedia) {
        let mediaOk = true;
        for (const a of input.brandAssets ?? []) {
          const abs = path.resolve(ROOT, a.path);
          if (!existsSync(abs)) {
            failures.push("品牌素材缺失：" + a.path + "（needs_asset）");
            mediaOk = false;
            continue;
          }
          const imp = await runScript("scripts/media-adapter.ts", ["import", "--file", a.path, "--license", "team-owned", "--source", "external"]);
          if (!imp.ok) {
            failures.push("素材导入失败：" + a.path + "：" + imp.output.split("\n").slice(-1)[0]);
            mediaOk = false;
          }
        }
        if (mediaOk) {
          const probe = await runScript("scripts/media-adapter.ts", ["probe", "--model", "Doubao-Seedream-5.0-lite"]);
          if (!probe.ok) {
            failures.push("默认图片模型 probe 失败（needs_asset，停止渲染）：" + probe.output.split("\n").slice(-1)[0]);
            await mkdir(path.join(runDir, "media"), { recursive: true });
            await writeFile(path.join(runDir, "media", "status.json"), JSON.stringify({ state: "needs_asset", reason: "Doubao-Seedream-5.0-lite probe 失败" }, null, 2), "utf-8");
          }
        }
      }

      const r = await runScript("scripts/generate-github-config.ts", [
        "--run-dir", path.relative(ROOT, runDir), "--kind", "own-project-weekly", "--date", date,
        "--own-project", ownFlag, "--no-check-assets",
      ]);
      if (r.ok) {
        await writeSpecs(runDir, await loadConfig(runDir));
        await markStageDone("weekly-own-" + slug + "-" + date, "script", { outputs: ["config/content.json", "video-spec.md", "storyboard.md"] });
        console.log("[weekly] weekly-own-" + slug + " ✓（video-spec/storyboard 已生成）");
      } else {
        failures.push("weekly-own-" + slug + "：" + r.output.split("\n").slice(-2).join(" | "));
      }
    }
  }

  if (failures.length > 0) {
    console.error("[weekly] 存在失败分支：");
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log("[weekly] 生成阶段完成；周六审查后周日入发布队列（runs/" + date + "/weekly-queue.json）");
}

const isDirectRun =
  process.argv[1] &&
  (import.meta.url === new URL("file://" + path.resolve(process.argv[1])).href ||
    import.meta.url.endsWith("/" + path.basename(process.argv[1])));
if (isDirectRun) {
  main().catch((e) => {
    console.error("[weekly] 失败:", e);
    process.exit(1);
  });
}