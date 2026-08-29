/**
 * 每日流水线编排器（§3.7）
 *
 * 阶段：
 *   1. 四场日报并行：research → score（--streams × --editions，各写自己的 run 目录）
 *   2. GitHub 候选并行：research(github-daily) → score → select-github
 *   3. 人工确认后（--github-selection）：每个仓库独立 run（github-daily-<slug>）→ generate-github-config
 *   4. 可选（--content）：新闻 run 继续 generate-content（原文快照 → config/content.json）
 *
 * 用法：
 *   node scripts/daily-pipeline.ts --date 2026-08-28 [--streams ai-news,world-news] \
 *     [--editions morning,evening] [--github-count 1|2] [--github-selection ...] [--content]
 * 测试：RESEARCH_FIXTURE=<items.json> 环境变量注入离线研究条目。
 */
import { mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { isStageDone } from "./stage.ts";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

interface BranchResult {
  label: string;
  ok: boolean;
  output: string;
}

async function runScript(script: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [script, ...args], {
      cwd: ROOT,
      env,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: ((err.stdout ?? "") + "\n" + (err.stderr ?? "")).trim() || (err.message ?? "unknown") };
  }
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
    console.error("[pipeline] 必须提供 --date YYYY-MM-DD");
    process.exit(1);
  }
  const streams = get("--streams", "ai-news,world-news").split(",").filter(Boolean);
  const editions = get("--editions", "morning,evening").split(",").filter(Boolean);
  const githubCount = parseInt(get("--github-count", "1"), 10);
  if (githubCount !== 1 && githubCount !== 2) {
    console.error("[pipeline] --github-count 只允许 1|2");
    process.exit(1);
  }
  const withContent = has("--content");
  const fetchSnapshots = has("--fetch-snapshots");
  const env = {
    ...process.env,
    ...(process.env.RESEARCH_FIXTURE ? { RESEARCH_FIXTURE: process.env.RESEARCH_FIXTURE } : {}),
  } as NodeJS.ProcessEnv;

  const results: BranchResult[] = [];
  const runDirBase = path.join("runs", date);

  // ── 阶段 1 + 2：四日报 + GitHub 候选，全部并行 ──
  const newsJobs: Promise<BranchResult>[] = [];
  for (const stream of streams) {
    for (const edition of editions) {
      const runId = stream + "-" + edition + "-" + date;
      newsJobs.push(
        (async () => {
          if (await isStageDone(runId, "research") && await isStageDone(runId, "score")) {
            return { label: runId, ok: true, output: "已存在（跳过）" };
          }
          const r1 = await runScript("scripts/daily-research.ts", ["--date", date, "--stream", stream, "--edition", edition], env);
          if (!r1.ok) return { label: runId + " research", ok: false, output: r1.output };
          const r2 = await runScript("scripts/score-and-rank.ts", ["--run-dir", path.join(runDirBase, stream + "-" + edition), "--stream", stream], env);
          return { label: runId, ok: r2.ok, output: r2.ok ? "[score] ok" : r2.output };
        })()
      );
    }
  }

  const githubJob: Promise<BranchResult> = (async () => {
    const runId = "github-" + date;
    if (await isStageDone(runId, "research") && await isStageDone(runId, "score")) {
      return { label: runId + " candidates", ok: true, output: "已存在（跳过）" };
    }
    const r1 = await runScript("scripts/daily-research.ts", ["--date", date, "--stream", "github-daily"], env);
    if (!r1.ok) return { label: runId + " research", ok: false, output: r1.output };
    const r2 = await runScript("scripts/score-and-rank.ts", ["--run-dir", path.join(runDirBase, "github"), "--stream", "github-daily"], env);
    return { label: runId + " candidates", ok: r2.ok, output: r2.ok ? "[score] github ok" : r2.output };
  })();

  const settled = await Promise.allSettled([...newsJobs, githubJob]);
  for (const s of settled) {
    if (s.status === "fulfilled") results.push(s.value);
    else results.push({ label: "unknown", ok: false, output: (s.reason as Error).message });
  }

  // ── 阶段 3：GitHub 选题确认 ──
  const githubRun = path.join(runDirBase, "github");
  const selFlag = get("--github-selection", "");
  const selRes = await runScript(
    "scripts/select-github.ts",
    selFlag ? ["--date", date, "--selection", selFlag] : ["--date", date],
    env
  );
  results.push({ label: "github select", ok: selRes.ok, output: selRes.output.split("\n").slice(-3).join("\n") });

  // 确认后：每个仓库独立 run config
  let repoRuns = 0;
  if (selRes.ok && selFlag) {
    const selPath = path.resolve(ROOT, selFlag);
    const fs = await import("node:fs/promises");
    try {
      const sel = JSON.parse(await fs.readFile(selPath, "utf-8")) as { repos: { full_name: string }[] };
      const repoJobs: Promise<BranchResult>[] = [];
      for (const repo of (sel.repos ?? []).slice(0, githubCount)) {
        const slug = repo.full_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        const repoRun = path.join(runDirBase, "github-daily-" + slug);
        await mkdir(path.join(ROOT, repoRun), { recursive: true });
        // 生成单仓库 selection 文件（generate-github-config 每个 run 只收一个仓库）
        const oneRepo = path.join(ROOT, runDirBase, "github", "selection-" + slug + ".json");
        const all = JSON.parse(await fs.readFile(selPath, "utf-8")) as { selected_by: string; selected_at: string; repos: any[] };
        await fs.writeFile(oneRepo, JSON.stringify({ ...all, repos: [repo] }, null, 2));
        repoJobs.push(
          runScript("scripts/generate-github-config.ts", [
            "--run-dir", repoRun, "--kind", "github-daily", "--date", date,
            "--selection", path.relative(ROOT, oneRepo),
            "--snapshot-dir", path.join(runDirBase, "github", "research", "snapshots"),
          ], env).then((r) => ({ label: "github-daily-" + slug, ok: r.ok, output: r.output }))
        );
      }
      const repoResults = await Promise.allSettled(repoJobs);
      for (const r of repoResults) {
        if (r.status === "fulfilled") {
          results.push(r.value);
          if (r.value.ok) repoRuns++;
        } else {
          results.push({ label: "github repo", ok: false, output: (r.reason as Error).message });
        }
      }
    } catch (e) {
      results.push({ label: "github repo config", ok: false, output: (e as Error).message });
    }
  }

  // ── 阶段 4（可选）：新闻 run 内容配置 ──
  if (withContent) {
    const contentJobs: Promise<BranchResult>[] = [];
    for (const stream of streams) {
      for (const edition of editions) {
        const runId = stream + "-" + edition + "-" + date;
        const runDir = path.join(runDirBase, stream + "-" + edition);
        contentJobs.push(
          runScript(
            "scripts/generate-content.ts",
            [
              "--run-dir", runDir, "--date", date, "--stream", stream, "--edition", edition,
              ...(fetchSnapshots ? ["--fetch-snapshots"] : []),
            ],
            env
          ).then((r) => ({ label: runId + " content", ok: r.ok, output: r.output }))
        );
      }
    }
    const contentResults = await Promise.allSettled(contentJobs);
    for (const r of contentResults) {
      if (r.status === "fulfilled") results.push(r.value);
      else results.push({ label: "content", ok: false, output: (r.reason as Error).message });
    }
  }

  // ── 汇总 ──
  const okCount = results.filter((r) => r.ok).length;
  console.log("");
  console.log("=== daily-pipeline 汇总（" + date + "）===");
  for (const r of results) {
    console.log((r.ok ? "[ok]   " : "[FAIL] ") + r.label);
    if (!r.ok) {
      for (const line of r.output.split("\n").slice(0, 6)) console.log("       " + line);
    }
  }
  console.log("成功 " + okCount + "/" + results.length + "（GitHub 已生成独立 run config: " + repoRuns + "）");

  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    console.error("[pipeline] 存在失败分支，退出非零（已保留其他成功分支）");
    process.exit(1);
  }
  if (!selFlag) {
    console.log("[pipeline] GitHub 停在 select 阶段：等待人工确认 selection.json（见 runs/" + date + "/github/research/recommendations.md）");
  }
}

const isDirectRun =
  process.argv[1] &&
  (import.meta.url === new URL("file://" + path.resolve(process.argv[1])).href ||
    import.meta.url.endsWith("/" + path.basename(process.argv[1])));
if (isDirectRun) {
  main().catch((e) => {
    console.error("[pipeline] 失败:", e);
    process.exit(1);
  });
}