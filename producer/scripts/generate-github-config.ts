/**
 * GitHub 项目介绍 / 自有项目 config 生成脚本 — 计划 §2.7
 *
 * github-daily / github-weekly：读取人工确认的 selection.json + GitHub API/README 快照，
 *   生成**单仓库** project-spotlight config 与 narration。禁止把两个仓库合并进一个 config
 *   （一个 run 只允许一个仓库；1–2 个选择由调用方拆成多个独立 run）。
 *   - 必须保留：API 快照 sha256、README URL、license、stars/forks/language、created_at、
 *     最近活动(pushed_at)，且每个数字(stats)都带 sourceUrl + sourceSnapshotHash。
 * own-project-weekly：读取显式 weekly/own-project.json，生成自有项目 config；
 *   缺资料即停止，绝不用 GitHub 统计填充。
 *
 * 环境变量：
 *   GITHUB_TOKEN=...（可选；GitHub API 未认证有速率限制，认证可提高配额）
 *
 * 用法（producer/ 下执行）：
 *   node scripts/generate-github-config.ts --run-dir runs/2026-08-28/github-daily-example
 *     --kind github-daily --date 2026-08-28 --selection runs/2026-08-28/github/selection.json
 *     [--snapshot-dir runs/2026-08-28/github/snapshots] [--fetch] [--style minimal-tech]
 *   node scripts/generate-github-config.ts --run-dir runs/2026-08-28/weekly-own-my-tool
 *     --kind own-project-weekly --date 2026-08-28 --own-project weekly/own-project.json
 *     [--no-check-assets] [--out ...]
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { VideoBlock, VideoConfig, VideoStyle } from "../src/data/types.ts";
import { runDirPaths } from "../src/data/timeline.ts";

const ROOT = process.cwd();

type Kind = "github-daily" | "github-weekly" | "own-project-weekly";

const KIND_RUN_PREFIX: Record<Kind, string> = {
  "github-daily": "github-daily-",
  "github-weekly": "weekly-github-",
  "own-project-weekly": "weekly-own-",
};
const VALID_STYLES: VideoStyle[] = [
  "minimal-tech",
  "whiteboard",
  "sticky-notes",
  "newspaper",
  "journal",
];
const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// ─────────────────────────── 输入类型 ───────────────────────────

interface GithubSelectionRepo {
  full_name: string;
  url: string;
  api_snapshot_sha256?: string;
  readme_snapshot_sha256?: string;
  selected_by?: string;
  selected_at?: string;
  rationale?: string;
  scraped_at?: string;
}

interface GithubSelectionFile {
  date?: string;
  run_id?: string;
  selected_by?: string;
  selected_at?: string;
  repos: GithubSelectionRepo[];
}

interface GithubApiData {
  full_name?: string;
  html_url?: string;
  description?: string | null;
  license?: { spdx_id?: string | null; url?: string | null } | null;
  stargazers_count?: number;
  forks_count?: number;
  language?: string | null;
  created_at?: string;
  pushed_at?: string | null;
  open_issues_count?: number;
  homepage?: string | null;
  topics?: string[];
  archived?: boolean;
}

interface OwnProjectInput {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  projectUrl: string;
  githubUrl?: string;
  docsUrl?: string;
  brandAssets?: { kind?: string; path: string; sha256?: string }[];
  sellingPoints: string[];
  cta: string;
  details?: {
    numbers?: { label: string; value: string; sourceUrl?: string; sourceSnapshotHash?: string }[];
  };
}

interface SnapshotSet {
  apiPath: string;
  apiContent: string;
  apiHash: string;
  readmePath: string;
  readmeContent: string;
  readmeHash: string;
}

// ─────────────────────────── 工具 ───────────────────────────

function fail(msg: string): never {
  console.error("[generate-github-config] " + msg);
  process.exit(1);
}

const sha256 = (s: string): string =>
  createHash("sha256").update(s, "utf-8").digest("hex");

async function fetchText(url: string, ms = 20000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const headers: Record<string, string> = {
      "User-Agent": "vido-producer (github-spotlight)",
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

function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/g, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/g, "") + "k";
  return String(n);
}

const NL = String.fromCharCode(10);
const TICK = String.fromCharCode(96);

/** 取 README 前 2-3 句作为介绍（去 Markdown 符号与链接） */
function readmeIntro(text: string, maxChars = 300): string {
  const noLinks = text
    .replace(/https?:\/\/[^ \t]+/g, "")
    .replace(/[#*_>~()!\[\]]/g, "")
    .replace(/ +/g, " ")
    .trim()
    .split(NL)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join(" ");
  const sentences = noLinks.split(/[。.!?！？]/).slice(0, 3).join("。");
  return (sentences || noLinks).slice(0, maxChars);
}

function readmeBullets(text: string, max = 5): string[] {
  const tickRe = new RegExp("[#*" + TICK + "]", "g");
  const lines = text
    .split(NL)
    .map((l) => l.trim())
    .filter((l) => /^[-*+] /.test(l))
    .map((l) => l.replace(/^[-*+] /, "").replace(tickRe, "").trim())
    .filter((l) => l.length > 4);
  return lines.slice(0, max);
}

function extractCodeSample(text: string): { code: string; language: string } | null {
  const fence = TICK + TICK + TICK;
  const re = new RegExp("^" + fence + "([A-Za-z0-9_]*)[^]*?^" + fence + "", "gm");
  const m = text.match(re);
  if (!m) return null;
  const block = m[0];
  const langRe = new RegExp("^" + fence + "([A-Za-z0-9_]*)");
  const language = langRe.exec(block)?.[1] ?? "";
  const startRe = new RegExp("^" + fence + "[A-Za-z0-9_]*" + NL);
  const endRe = new RegExp(NL + fence + "$");
  const code = block
    .replace(startRe, "")
    .replace(endRe, "")
    .trim();
  if (!code) return null;
  return { code: code.slice(0, 500), language: language || "bash" };
}

// ─────────────────────────── GitHub 快照 ───────────────────────────

function snapshotFilenames(fullName: string): { owner: string; repo: string; apiName: string; readmeName: string } {
  const parts = fullName.split("/");
  const owner = parts[0] ?? "x";
  const repo = parts[1] ?? "x";
  return {
    owner,
    repo,
    apiName: owner + "__" + repo + ".api.json",
    readmeName: owner + "__" + repo + ".readme.md",
  };
}

async function resolveGithubSnapshots(
  repo: GithubSelectionRepo,
  snapshotDir: string,
  fetchEnabled: boolean
): Promise<SnapshotSet> {
  const names = snapshotFilenames(repo.full_name);
  const apiPath = path.join(snapshotDir, names.apiName);
  const readmePath = path.join(snapshotDir, names.readmeName);

  const readOrFetch = async (
    file: string,
    url: string,
    kind: "api" | "readme"
  ): Promise<{ content: string; hash: string }> => {
    let content: string;
    if (!fetchEnabled && existsSync(file)) {
      content = await readFile(file, "utf-8");
    } else {
      content = await fetchText(url);
      await mkdir(snapshotDir, { recursive: true });
      await writeFile(file, content, "utf-8");
    }
    const hash = sha256(content);
    const expected =
      kind === "api" ? repo.api_snapshot_sha256 : repo.readme_snapshot_sha256;
    if (expected && expected !== hash) {
      fail(
        repo.full_name + " 的 " + kind + " 快照 hash 与 selection 不一致：\n" +
          "  selection=" + expected + "\n  actual  =" + hash + "\n  拒绝生成（可能快照被篡改）"
      );
    }
    return { content, hash };
  };

  const api = await readOrFetch(
    apiPath,
    "https://api.github.com/repos/" + repo.full_name,
    "api"
  );
  const readme = await readOrFetch(
    readmePath,
    "https://raw.githubusercontent.com/" + repo.full_name + "/HEAD/README.md",
    "readme"
  );
  return {
    apiPath,
    apiContent: api.content,
    apiHash: api.hash,
    readmePath,
    readmeContent: readme.content,
    readmeHash: readme.hash,
  };
}

// ─────────────────────────── GitHub spotlight blocks ───────────────────────────

function githubBlocks(
  api: GithubApiData,
  readme: string,
  snaps: SnapshotSet,
  fullName: string
): { blocks: VideoBlock[]; sourceRefs: { url: string; sha256: string }[] } {
  const htmlUrl = api.html_url ?? "https://github.com/" + fullName;
  const apiRef = "https://api.github.com/repos/" + fullName;
  const readmeRawUrl = "https://raw.githubusercontent.com/" + fullName + "/HEAD/README.md";
  const readmePageUrl = "https://github.com/" + fullName + "#readme";
  const apiHash = snaps.apiHash;
  const readmeHash = snaps.readmeHash;
  const disclaimer =
    "数据来自 GitHub API 快照(" + apiHash.slice(0, 12) + ")与仓库 README(" + readmeHash.slice(0, 12) +
    ")，生成于 " + new Date().toISOString().slice(0, 10) + "，以快照为准。";

  const stars = Number(api.stargazers_count ?? 0);
  const forks = Number(api.forks_count ?? 0);
  const license = api.license?.spdx_id ?? "未标注";
  const language = api.language ?? "未标注";
  const numSource = (): { sourceUrl: string; sourceSnapshotHash: string } => ({
    sourceUrl: apiRef,
    sourceSnapshotHash: apiHash,
  });
  const stats: NonNullable<VideoBlock["stats"]> = [
    { label: "Stars", value: formatCompact(stars), ...numSource() },
    { label: "Forks", value: formatCompact(forks), ...numSource() },
    { label: "License", value: license, sourceUrl: api.license?.url ?? htmlUrl, sourceSnapshotHash: apiHash },
    { label: "Language", value: language, ...numSource() },
  ];

  const intro = readmeIntro(readme);
  const bullets = readmeBullets(readme);
  const code = extractCodeSample(readme);
  const tagline =
    (api.description ?? "").trim().split(NL)[0] || fullName + " 开源项目";
  const summary = intro || (api.description ?? "").trim() || "暂无描述";

  const blocks: VideoBlock[] = [];

  // 开场（HookPage）
  blocks.push({
    type: "title",
    content: fullName,
    desc: tagline,
    summary,
    facts: [
      "GitHub 仓库：" + fullName + "（API 快照 " + apiHash.slice(0, 12) + "）",
      "原始描述：" + tagline,
      "许可：" + license + "（来源：GitHub API）",
    ],
    stats,
    highlight: formatCompact(stars) + " stars",
    narration:
      "今天介绍开源项目 " + fullName + "。" + tagline +
      " 目前已经积累了 " + formatCompact(stars) + " 颗星，" + formatCompact(forks) + " 次 fork。",
    url: htmlUrl,
    sourceSnapshotHash: apiHash,
    disclaimer,
    source: "GitHub",
  });

  // 问题对比页
  blocks.push({
    type: "text",
    content: fullName + " 解决什么问题",
    summary: summary,
    facts: [
      "项目定位（README 快照 " + readmeHash.slice(0, 12) + "）：" + summary,
      "创建时间：" + (api.created_at ?? "未知") + "（来源：GitHub API）",
    ],
    items: ["没有它：手动重复劳动", "有它：一键自动化/开箱即用"],
    narration:
      "它解决的问题很简单：把原本要自己折腾的流程，变成开箱即用的工具。",
    url: readmePageUrl,
    sourceSnapshotHash: readmeHash,
    disclaimer,
    source: "README",
    section: "problem",
  });

  // 特性页（列表 + 数据卡）
  const featuresPoints = bullets.length
    ? bullets
    : [
        "开源且可自托管（许可：" + license + "）",
        "主要语言：" + language,
        "活跃维护中（最近提交 " + (api.pushed_at ?? "未知").slice(0, 10) + "）",
      ];
  blocks.push({
    type: "list",
    content: "亮点与数据",
    points: featuresPoints,
    stats,
    summary: intro || "核心特性见下方要点与数据卡。",
    facts: [
      "Stars/Forks/License/Language 来源：GitHub API 快照 " + apiHash.slice(0, 12),
      "最近活动（pushed_at）：" + (api.pushed_at ?? "未知") + "，来源：GitHub API",
      "Topics：" + ((api.topics ?? []).join("、") || "无标签"),
    ],
    narration: "亮点和数据都在这里，看数据最直观。",
    url: readmePageUrl,
    sourceSnapshotHash: readmeHash,
    disclaimer,
    source: "GitHub API + README",
    section: "features",
  });

  // 动手试用（若 README 有代码片段）
  if (code) {
    blocks.push({
      type: "code",
      content: code.code,
      language: code.language,
      summary: "来自 README 的快速上手示例。",
      facts: ["安装/使用示例来自 README 快照 " + readmeHash.slice(0, 12)],
      points: ["复制上面的命令即可开始体验"],
      highlight: "",
      narration: "上手很简单，照着 README 里的示例跑一遍就行。",
      url: readmePageUrl,
      sourceSnapshotHash: readmeHash,
      disclaimer,
      source: "README",
      section: "hands-on",
    });
  }

  // 结尾 CTA
  blocks.push({
    type: "text",
    content: "一起去看看",
    desc: htmlUrl,
    summary: "开源、免费、可自托管。完整文档与代码都在仓库里。",
    facts: [
      "仓库地址：" + htmlUrl,
      "README 原文：" + readmePageUrl,
    ],
    points: ["Star 支持一下", "看 README / Demo", "提 Issue 参与共建"],
    narration: "想深入了解，就去仓库主页看看吧，记得顺手点个 Star。",
    url: htmlUrl,
    sourceSnapshotHash: readmeHash,
    disclaimer,
    source: "GitHub",
    section: "outro",
  });

  const sourceRefs = [
    { url: apiRef, sha256: apiHash },
    { url: readmeRawUrl, sha256: readmeHash },
  ];
  return { blocks, sourceRefs };
}

// ─────────────────────────── 自有项目 blocks ───────────────────────────

function ownProjectBlocks(input: OwnProjectInput, inputPath: string): { blocks: VideoBlock[]; sourceRefs: { url: string; sha256: string }[] } {
  const inputHash = sha256(inputPath);
  const disclaimer =
    "本项目资料由团队提供（输入快照 " + inputHash.slice(0, 12) + "），生成于 " +
    new Date().toISOString().slice(0, 10) + "，官方信息以 " + input.projectUrl + " 为准。";

  const numbers: NonNullable<VideoBlock["stats"]> = (input.details?.numbers ?? []).map((n) => ({
    label: n.label,
    value: n.value,
    sourceUrl: n.sourceUrl ?? input.projectUrl,
    sourceSnapshotHash: n.sourceSnapshotHash ?? inputHash,
  }));

  const blocks: VideoBlock[] = [];

  // 开场（HookPage）
  blocks.push({
    type: "title",
    content: input.name,
    desc: input.tagline,
    summary: input.description,
    facts: [
      "官方项目页：" + input.projectUrl,
      ...(input.githubUrl ? ["开源仓库：" + input.githubUrl] : []),
      ...(input.docsUrl ? ["文档：" + input.docsUrl] : []),
    ],
    stats: numbers.length ? numbers : undefined,
    highlight: input.tagline,
    narration: "今天介绍我们自己的项目：" + input.name + "。" + input.tagline,
    url: input.projectUrl,
    sourceSnapshotHash: inputHash,
    disclaimer,
    source: "own-project",
  });

  // 卖点
  blocks.push({
    type: "list",
    content: "为什么值得一试",
    points: input.sellingPoints,
    summary: input.description,
    facts: input.sellingPoints.map((p) => "卖点：" + p + "（来源：" + input.projectUrl + "）"),
    stats: numbers.length ? numbers : undefined,
    narration: "这几个卖点，是它值得你花两分钟看看的原因。",
    url: input.projectUrl,
    sourceSnapshotHash: inputHash,
    disclaimer,
    source: "own-project",
    section: "features",
  });

  // 品牌素材（若有，校验已在上游完成，此处只引用路径）
  const asset = (input.brandAssets ?? []).find((a) => /\.(png|jpe?g|webp)$/i.test(a.path));
  if (asset) {
    blocks.push({
      type: "image",
      content: input.name,
      src: asset.path,
      summary: "官方品牌素材（" + (asset.kind ?? "cover") + "）。",
      facts: ["素材路径：" + asset.path],
      points: ["官方品牌资产，来源：" + input.projectUrl],
      narration: "这是它的官方视觉物料。",
      url: input.projectUrl,
      sourceSnapshotHash: inputHash,
      disclaimer,
      source: "own-project",
      section: "features",
    });
  }

  // CTA
  blocks.push({
    type: "text",
    content: input.cta,
    desc: input.projectUrl,
    summary: "现在就体验：" + input.projectUrl,
    facts: [
      "项目链接：" + input.projectUrl,
      ...(input.githubUrl ? ["GitHub：" + input.githubUrl] : []),
    ],
    points: ["官网体验", "查看源码", "反馈建议"],
    narration: input.cta + "，链接就在屏幕上。",
    url: input.projectUrl,
    sourceSnapshotHash: inputHash,
    disclaimer,
    source: "own-project",
    section: "outro",
  });

  const sourceRefs = [
    { url: input.projectUrl, sha256: inputHash },
    ...(input.githubUrl ? [{ url: input.githubUrl, sha256: inputHash }] : []),
    ...(input.docsUrl ? [{ url: input.docsUrl, sha256: inputHash }] : []),
  ];
  return { blocks, sourceRefs };
}

// ─────────────────────────── 主流程 ───────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const has = (flag: string) => args.includes(flag);

  const runDirFlag = get("--run-dir", "");
  if (!runDirFlag) fail("必须提供 --run-dir（如 runs/2026-08-28/github-daily-example）");
  const runDir = path.resolve(ROOT, runDirFlag);
  const runPaths = runDirPaths(runDir);

  const kind = get("--kind", "") as Kind;
  if (kind !== "github-daily" && kind !== "github-weekly" && kind !== "own-project-weekly") {
    fail("--kind 只允许 github-daily|github-weekly|own-project-weekly，收到：" + kind);
  }
  const base = path.basename(runDir);
  if (!base.startsWith(KIND_RUN_PREFIX[kind])) {
    fail("run 目录与 kind 不匹配：" + base + "（" + kind + " 必须以 " + KIND_RUN_PREFIX[kind] + " 开头）");
  }

  const date = get("--date", path.basename(path.dirname(runDir)));
  if (!DATE_RE.test(date)) fail("--date 必须为 YYYY-MM-DD，收到：" + date);
  const runId = base + "-" + date;
  const style = get("--style", "minimal-tech") as VideoStyle;
  if (!VALID_STYLES.includes(style)) fail("--style 非法：" + style);
  const outPath = path.resolve(ROOT, get("--out", runPaths.configPath));

  let blocks: VideoBlock[];
  let sourceRefs: { url: string; sha256: string }[];
  let title: string;
  let subtitle: string | undefined;

  if (kind === "github-daily" || kind === "github-weekly") {
    // ── GitHub 分支：必须有人工确认 selection，且一个 run 只处理一个仓库 ──
    const selFlag = get("--selection", "");
    if (!selFlag) fail(kind + " 需要 --selection（人工确认的 selection.json，见 §3.4）");
    const selPath = path.resolve(ROOT, selFlag);
    let sel: GithubSelectionFile;
    try {
      sel = JSON.parse(await readFile(selPath, "utf-8")) as GithubSelectionFile;
    } catch {
      fail("无法读取 selection：" + path.relative(ROOT, selPath));
    }
    if (!Array.isArray(sel.repos) || sel.repos.length === 0) fail("selection.repos 为空（未确认选题）");
    if (sel.repos.length !== 1) {
      fail(
        "selection 包含 " + sel.repos.length + " 个仓库；一个 run 只能生成一个仓库的 config" +
          "（请拆分为独立 run：github-daily-<slug> 各自对应一个仓库）"
      );
    }
    const repo = sel.repos[0];
    if (!REPO_RE.test(repo.full_name)) {
      fail("selection.repos[0].full_name 格式非法：" + repo.full_name);
    }

    const snapshotDir = path.resolve(ROOT, get("--snapshot-dir", path.join(runDir, "research", "snapshots")));
    const fetchEnabled = has("--fetch");
    const snaps = await resolveGithubSnapshots(repo, snapshotDir, fetchEnabled);
    console.log("[generate-github-config] API 快照   " + snaps.apiHash.slice(0, 12) + "… ← " + repo.full_name);
    console.log("[generate-github-config] README 快照 " + snaps.readmeHash.slice(0, 12) + "… ← " + repo.full_name);

    const api = JSON.parse(snaps.apiContent) as GithubApiData;
    const out = githubBlocks(api, snaps.readmeContent, snaps, repo.full_name);
    blocks = out.blocks;
    sourceRefs = out.sourceRefs;
    title = repo.full_name + " 开源项目介绍";
    subtitle = api.description?.trim().split(NL)[0] ?? "一个值得了解的开源项目";
  } else {
    // ── 自有项目分支：显式 own-project.json，缺资料即停止 ──
    const inputFlag = get("--own-project", "");
    if (!inputFlag) fail("own-project-weekly 需要 --own-project weekly/own-project.json");
    const inputPath = path.resolve(ROOT, inputFlag);
    if (!existsSync(inputPath)) fail("own-project.json 不存在：" + path.relative(ROOT, inputPath));
    const input = JSON.parse(await readFile(inputPath, "utf-8")) as OwnProjectInput;

    const missing: string[] = [];
    for (const key of ["slug", "name", "tagline", "description", "projectUrl", "cta"] as const) {
      if (!(input[key] ?? "").trim()) missing.push(key);
    }
    if (!Array.isArray(input.sellingPoints) || input.sellingPoints.length === 0) missing.push("sellingPoints");
    if (!Array.isArray(input.brandAssets) || input.brandAssets.length === 0) missing.push("brandAssets");
    if (missing.length) {
      fail(
        "own-project.json 缺少必需字段：" + missing.join(", ") +
          "。缺资料时停止，不用 GitHub 统计填充。"
      );
    }

    if (!has("--no-check-assets")) {
      for (const a of input.brandAssets ?? []) {
        const p = path.resolve(ROOT, a.path);
        if (!existsSync(p)) {
          fail("品牌素材文件不存在（运行 --no-check-assets 可跳过）：" + a.path);
        }
        // 导入素材必须重新计算 SHA-256（§5.6）
        const fileText = await readFile(p, "utf-8");
        const h = sha256(fileText);
        console.log(
          "[generate-github-config] 素材 " + a.path + " sha256=" + h.slice(0, 16) + "…" +
            (a.sha256 ? (a.sha256 === h ? "（与输入一致）" : "（与输入不一致，已按实际重算）") : "（新增）")
        );
      }
    }

    const out = ownProjectBlocks(input, inputPath);
    blocks = out.blocks;
    sourceRefs = out.sourceRefs;
    title = input.name + " 项目介绍";
    subtitle = input.tagline;
  }

  const engine = kind === "github-daily" ? "hyperframes" : "remotion";
  const config: VideoConfig = {
    type: kind,
    style,
    title,
    subtitle,
    engine,
    template: "project-spotlight",
    chapters: [{ start: "00:00", title: title }],
    blocks,
    workflowId: kind === "github-daily" ? "github-daily-spotlight" : "weekly-spotlight",
    runId,
    cadence: kind === "github-daily" ? "daily" : "weekly",
    sourceRefs,
    mediaManifestPath: runDir + "/media/media-manifest.json",
  };

  await mkdir(path.dirname(outPath), { recursive: true });
  const tmp = outPath + ".tmp";
  await writeFile(tmp, JSON.stringify(config, null, 2), "utf-8");
  await rename(tmp, outPath);

  console.log(
    "[generate-github-config] 生成 " + blocks.length + " 块 → " + path.relative(ROOT, outPath) +
      "（run_id=" + runId + "，" + engine + "，" + sourceRefs.length + " 个来源引用）"
  );
  console.log("[generate-github-config] 下一步：node scripts/prepare-audio.ts --run-dir " + path.relative(ROOT, runDir));
}

main().catch((e) => {
  console.error("[generate-github-config] 失败:", e);
  process.exit(1);
});
