/**
 * GitHub 选题确认脚本（§3.4）
 *
 * 输入：runs/<date>/github/research/selection-candidates.json（来自 score-and-rank --stream github-daily）
 * 动作：
 *   1. 对每个候选固定 GitHub API metadata 与 README 快照（sha256，写 research/snapshots/）；
 *   2. 生成 research/recommendations.md（3 张推荐卡，含 rationale）与 selection.template.json；
 *   3. 若提供 --selection（人工确认文件）：校验 1–2 个仓库、selected_by/selected_at、
 *      快照 hash 一致后，写 runs/<date>/github/selection.json（canonical）。
 * 未确认 → 停在 select 阶段（不生成 config/渲染/交接包）。
 *
 * 用法：
 *   node scripts/select-github.ts --date 2026-08-28 [--fetch]
 *   node scripts/select-github.ts --date 2026-08-28 --selection /path/confirmed.json
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { markStageDone } from "./stage.ts";

const ROOT = process.cwd();
const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const FENCE = String.fromCharCode(96) + String.fromCharCode(96) + String.fromCharCode(96);

interface Candidate {
  id: string;
  title: string;
  url: string;
  source: string;
  total: number;
  stars?: number;
  forks?: number;
  language?: string;
  license?: string;
  createdAt?: string;
  pushedAt?: string;
  readmeUrl?: string;
  scores?: Record<string, number>;
}

interface ConfirmedSelection {
  date?: string;
  run_id?: string;
  selected_by: string;
  selected_at: string;
  repos: {
    full_name: string;
    url: string;
    api_snapshot_sha256?: string;
    readme_snapshot_sha256?: string;
    rationale?: string;
  }[];
}

function fail(msg: string): never {
  console.error("[select-github] " + msg);
  process.exit(1);
}

const sha256 = (s: string): string =>
  createHash("sha256").update(s, "utf-8").digest("hex");

async function fetchText(url: string, ms = 20000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const headers: Record<string, string> = {
      "User-Agent": "vido-producer (select-github)",
      Accept: "application/vnd.github+json",
    };
    if (process.env.GITHUB_TOKEN) headers.Authorization = "Bearer " + process.env.GITHUB_TOKEN;
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function repoParts(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split("/");
  return { owner: owner ?? "x", repo: repo ?? "x" };
}

async function ensureSnapshots(
  fullName: string,
  snapshotDir: string,
  fetchEnabled: boolean
): Promise<{ apiHash: string; readmeHash: string; readmeUrl: string }> {
  const { owner, repo } = repoParts(fullName);
  const apiPath = path.join(snapshotDir, owner + "__" + repo + ".api.json");
  const readmePath = path.join(snapshotDir, owner + "__" + repo + ".readme.md");

  const readOrFetch = async (file: string, url: string): Promise<{ content: string; hash: string }> => {
    let content: string;
    if (!fetchEnabled && existsSync(file)) {
      content = await readFile(file, "utf-8");
    } else {
      content = await fetchText(url);
      await mkdir(snapshotDir, { recursive: true });
      await writeFile(file, content, "utf-8");
    }
    return { content, hash: sha256(content) };
  };

  const api = await readOrFetch(apiPath, "https://api.github.com/repos/" + fullName);
  const readmeRawUrl = "https://raw.githubusercontent.com/" + fullName + "/HEAD/README.md";
  const readme = await readOrFetch(readmePath, readmeRawUrl);
  return { apiHash: api.hash, readmeHash: readme.hash, readmeUrl: readmeRawUrl };
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const has = (flag: string) => args.includes(flag);

  const date = get("--date", "");
  if (!DATE_RE.test(date)) fail("--date 必须为 YYYY-MM-DD");
  const fetchEnabled = has("--fetch");
  const runDir = path.join(ROOT, "runs", date, "github");
  const researchDir = path.join(runDir, "research");
  const snapshotDir = path.join(researchDir, "snapshots");
  const candidatesPath = path.join(researchDir, "selection-candidates.json");

  let candidates: Candidate[];
  try {
    const raw = JSON.parse(await readFile(candidatesPath, "utf-8")) as { candidates: Candidate[] };
    candidates = raw.candidates ?? [];
  } catch {
    fail("无法读取候选：" + candidatesPath + "（先跑 research+score --stream github-daily）");
  }
  if (candidates.length === 0) fail("候选为空");

  // 1) 固定快照
  const enriched: { candidate: Candidate; fullName: string; apiHash: string; readmeHash: string }[] = [];
  for (const c of candidates.slice(0, 5)) {
    let fullName = c.title.split(" — ")[0] ?? "";
    if (!REPO_RE.test(fullName)) {
      const m = /github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/.exec(c.url);
      fullName = m ? m[1] : "";
    }
    if (!REPO_RE.test(fullName)) {
      console.warn("[select-github] 无法解析仓库名，跳过候选：" + c.title);
      continue;
    }
    try {
      const snaps = await ensureSnapshots(fullName, snapshotDir, fetchEnabled);
      enriched.push({ candidate: c, fullName, apiHash: snaps.apiHash, readmeHash: snaps.readmeHash });
      console.log("[select-github] 快照 " + fullName + " api=" + snaps.apiHash.slice(0, 12) + " readme=" + snaps.readmeHash.slice(0, 12));
    } catch (e) {
      console.warn("[select-github] " + fullName + " 快照失败（跳过）: " + (e as Error).message);
    }
  }
  if (enriched.length === 0) fail("没有任何候选能固定快照");

  // 2) 推荐卡 + selection 模板
  const top3 = enriched.slice(0, 3);
  const md: string[] = ["# GitHub 选题推荐（" + date + "）", "", "> 供人工确认；确认后写入 selection.json（1–2 个仓库）。", ""];
  top3.forEach((e, i) => {
    const c = e.candidate;
    md.push(
      "## " + (i + 1) + ". " + e.fullName + "（总分 " + c.total.toFixed(1) + "）",
      "",
      "- 链接：" + c.url,
      "- Stars " + (c.stars ?? "-") + " / Forks " + (c.forks ?? "-") + " / " + (c.language ?? "-") + " / " + (c.license ?? "-"),
      "- created " + (c.createdAt ?? "-").slice(0, 10) + " / pushed " + (c.pushedAt ?? "-").slice(0, 10),
      "- API 快照：" + e.apiHash.slice(0, 16) + "…",
      "- README 快照：" + e.readmeHash.slice(0, 16) + "…",
      "- 选题理由：视频化潜力 " + (c.scores?.videoPotential ?? "-") + "，实用度 " + (c.scores?.utility ?? "-") + "（启发式）",
      ""
    );
  });
  md.push("---", "确认文件示例（1–2 个仓库，selected_by/selected_at 必填）：", "");
  md.push(FENCE + "json");
  md.push(JSON.stringify({
    date,
    selected_by: "operator-name",
    selected_at: new Date().toISOString(),
    repos: top3.slice(0, 2).map((e) => ({
      full_name: e.fullName,
      url: e.candidate.url,
      api_snapshot_sha256: e.apiHash,
      readme_snapshot_sha256: e.readmeHash,
      rationale: "",
    })),
  }, null, 2));
  md.push(FENCE);
  await mkdir(researchDir, { recursive: true });
  await writeFile(path.join(researchDir, "recommendations.md"), md.join("\n"), "utf-8");
  await writeFile(
    path.join(researchDir, "selection.template.json"),
    JSON.stringify({
      date,
      selected_by: "",
      selected_at: "",
      repos: top3.slice(0, 2).map((e) => ({
        full_name: e.fullName,
        url: e.candidate.url,
        api_snapshot_sha256: e.apiHash,
        readme_snapshot_sha256: e.readmeHash,
        rationale: "",
      })),
    }, null, 2),
    "utf-8"
  );

  // 3) 人工确认
  const confirmFlag = get("--selection", "");
  if (!confirmFlag) {
    console.log("[select-github] 已生成 3 张推荐卡：runs/" + date + "/github/research/recommendations.md");
    console.log("[select-github] 等待人工确认：复制 selection.template.json 填写后，用 --selection 传入");
    return; // 停在 select 阶段
  }

  const confirmPath = path.resolve(ROOT, confirmFlag);
  let sel: ConfirmedSelection;
  try {
    sel = JSON.parse(await readFile(confirmPath, "utf-8")) as ConfirmedSelection;
  } catch {
    fail("无法读取确认文件：" + confirmFlag);
  }
  if (!(sel.selected_by ?? "").trim() || !(sel.selected_at ?? "").trim()) {
    fail("确认文件必须填写 selected_by 与 selected_at（operator 身份，不能自报为空）");
  }
  if (!Array.isArray(sel.repos) || sel.repos.length === 0 || sel.repos.length > 2) {
    fail("必须选择 1–2 个仓库");
  }
  for (const r of sel.repos) {
    if (!REPO_RE.test(r.full_name)) fail("仓库名非法：" + r.full_name);
    const known = enriched.find((e) => e.fullName === r.full_name);
    if (!known) fail("确认的仓库不在候选列表：" + r.full_name);
    if (r.api_snapshot_sha256 && r.api_snapshot_sha256 !== known.apiHash) {
      fail(r.full_name + " API 快照 hash 与候选不一致：selection=" + r.api_snapshot_sha256 + " actual=" + known.apiHash);
    }
    if (r.readme_snapshot_sha256 && r.readme_snapshot_sha256 !== known.readmeHash) {
      fail(r.full_name + " README 快照 hash 与候选不一致");
    }
  }

  const canonical: ConfirmedSelection = {
    date,
    run_id: "github-" + date,
    selected_by: sel.selected_by,
    selected_at: sel.selected_at,
    repos: sel.repos.map((r) => {
      const known = enriched.find((e) => e.fullName === r.full_name)!;
      return {
        full_name: r.full_name,
        url: r.url || known.candidate.url,
        api_snapshot_sha256: r.api_snapshot_sha256 ?? known.apiHash,
        readme_snapshot_sha256: r.readme_snapshot_sha256 ?? known.readmeHash,
        rationale: r.rationale,
      };
    }),
  };
  await writeFile(path.join(runDir, "selection.json"), JSON.stringify(canonical, null, 2), "utf-8");

  await markStageDone("github-" + date, "select", {
    input_summary: "selected " + canonical.repos.length + " repos by " + canonical.selected_by,
    outputs: [path.relative(ROOT, path.join(runDir, "selection.json"))],
  });
  console.log("[select-github] 已确认 " + canonical.repos.length + " 个仓库 → runs/" + date + "/github/selection.json");
  console.log("[select-github] 下一步：为每个仓库生成独立 run config（generate-github-config）");
}

const isDirectRun =
  process.argv[1] &&
  (import.meta.url === new URL("file://" + path.resolve(process.argv[1])).href ||
    import.meta.url.endsWith("/" + path.basename(process.argv[1])));
if (isDirectRun) {
  main().catch((e) => {
    console.error("[select-github] 失败:", e);
    process.exit(1);
  });
}
