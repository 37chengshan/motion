/**
 * 阶段断点 — 定时任务幂等续跑的状态簿（runs/index.json）
 *
 * 以完整 run_id 为 key 记录已完成阶段；重入时跳过已完成阶段。
 * 阶段序列（计划 §2.4）：
 *   research → score → select(if required) → script → media → voiceover → timeline → compose → render → review → package
 * 每个阶段记录：输入摘要、输出清单、commit、开始/结束时间、错误。原子写（临时文件 + rename）。
 *
 * 用法：
 *   node scripts/stage.ts get <run_id>
 *   node scripts/stage.ts done <run_id> <stage> [--meta <json>]
 *   node scripts/stage.ts reset <run_id>
 *   node scripts/stage.ts next <run_id> <stage1,stage2,...>
 *   node scripts/stage.ts list [--date YYYY-MM-DD]
 *
 * run_id 示例：ai-news-morning-2026-08-28 / world-news-evening-2026-08-28 /
 *   github-daily-<repo-slug> / weekly-github-<slug> / weekly-own-<slug>
 * 注意：daily-pipeline --date 必须把同一业务日期传给每个 run；本模块不读取系统日期。
 */
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = process.cwd(); // producer/
const STATE_PATH = path.join(ROOT, "runs", "index.json");

export const STAGE_ORDER = [
  "research",
  "score",
  "select",
  "script",
  "media",
  "voiceover",
  "timeline",
  "compose",
  "render",
  "review",
  "package"
] as const;

export type StageName = (typeof STAGE_ORDER)[number];

export interface StageRecord {
  stage: StageName;
  status: "pending" | "done" | "error";
  input_summary?: string;
  outputs?: string[];
  commit?: string;
  started_at?: string;
  finished_at?: string;
  error?: string;
}

export interface RunStatus {
  run_id: string;
  stages: Record<string, StageRecord>;
}

type Index = Record<string, RunStatus>;

export const stageStatePath = (): string => STATE_PATH;

/** 阶段完成标记（供各阶段脚本/编排器调用，原子写） */
export async function markStageDone(
  runId: string,
  stage: StageName,
  meta: { input_summary?: string; outputs?: string[]; commit?: string; started_at?: string } = {}
): Promise<void> {
  const index = await readIndex();
  const run = (index[runId] ??= { run_id: runId, stages: {} });
  run.stages[stage] = {
    stage,
    status: "done",
    input_summary: meta.input_summary,
    outputs: meta.outputs,
    commit: meta.commit ?? getCommit(),
    started_at: meta.started_at ?? run.stages[stage]?.started_at,
    finished_at: new Date().toISOString(),
    error: undefined,
  };
  await writeIndex(index);
}

/** 读取某 run 已完成阶段集合 */
export async function getDoneStages(runId: string): Promise<StageName[]> {
  const index = await readIndex();
  const run = index[runId];
  if (!run) return [];
  return (Object.entries(run.stages) as [StageName, StageRecord][])
    .filter(([, s]) => s.status === "done")
    .map(([k]) => k);
}

/** 阶段是否已完成（幂等续跑用） */
export async function isStageDone(runId: string, stage: StageName): Promise<boolean> {
  return (await getDoneStages(runId)).includes(stage);
}

async function readIndex(): Promise<Index> {
  try {
    const raw = JSON.parse(await readFile(STATE_PATH, "utf-8"));
    return typeof raw === "object" && raw !== null ? raw : {};
  } catch {
    return {};
  }
}

async function writeIndex(index: Index): Promise<void> {
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  const tmp = STATE_PATH + ".tmp";
  await writeFile(tmp, JSON.stringify(index, null, 2), "utf-8");
  await rename(tmp, STATE_PATH);
}

function getCommit(): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

async function main() {
  const [action, runId, arg3] = process.argv.slice(2);
  if (!action || !runId) {
    console.error("用法：node scripts/stage.ts <get|done|reset|next|list> <run_id> [stage|order] [--meta json]");
    process.exit(1);
  }
  const index = await readIndex();

  switch (action) {
    case "get": {
      const run = index[runId];
      console.log(run ? Object.keys(run.stages).join(",") : "");
      break;
    }
    case "done": {
      if (!arg3) {
        console.error("[stage] done 需要阶段名");
        process.exit(1);
      }
      const stage = arg3 as StageName;
      if (!STAGE_ORDER.includes(stage)) {
        console.error(`[stage] 未知阶段：${stage}（允许：${STAGE_ORDER.join(",")}）`);
        process.exit(1);
      }
      const metaIdx = process.argv.indexOf("--meta");
      let meta: Record<string, unknown> = {};
      if (metaIdx !== -1 && process.argv[metaIdx + 1]) {
        try {
          meta = JSON.parse(process.argv[metaIdx + 1]);
        } catch {
          console.error("[stage] --meta 必须是合法 JSON");
          process.exit(1);
        }
      }
      const run = (index[runId] ??= { run_id: runId, stages: {} });
      run.stages[stage] = {
        stage,
        status: "done",
        input_summary: (meta.input_summary as string) ?? undefined,
        outputs: (meta.outputs as string[]) ?? undefined,
        commit: (meta.commit as string) ?? getCommit(),
        started_at: (meta.started_at as string) ?? run.stages[stage]?.started_at,
        finished_at: new Date().toISOString(),
        error: undefined
      };
      await writeIndex(index);
      console.log(`[stage] ${runId} 完成阶段：${Object.keys(run.stages).join(" → ")}`);
      break;
    }
    case "reset": {
      delete index[runId];
      await writeIndex(index);
      console.log(`[stage] ${runId} 已清空`);
      break;
    }
    case "next": {
      const order = (arg3 ?? "").split(",").filter(Boolean);
      const run = index[runId];
      const done = new Set(run ? Object.entries(run.stages).filter(([, s]) => s.status === "done").map(([k]) => k) : []);
      const next = order.find((s) => !done.has(s));
      console.log(next ?? "");
      if (!next) console.log(`[stage] ${runId} 全部阶段已完成`);
      break;
    }
    case "list": {
      const dateIdx = process.argv.indexOf("--date");
      const date = dateIdx !== -1 ? process.argv[dateIdx + 1] : undefined;
      for (const [id, run] of Object.entries(index)) {
        if (date && !id.includes(date)) continue;
        const doneStages = Object.entries(run.stages)
          .filter(([, s]) => s.status === "done")
          .map(([k]) => k);
        console.log(`${id}\t${doneStages.join(",")}`);
      }
      break;
    }
    default: {
      console.error(`[stage] 未知动作：${action}`);
      process.exit(1);
    }
  }
}

const isDirectRun =
  process.argv[1] &&
  (import.meta.url === new URL("file://" + path.resolve(process.argv[1])).href ||
   import.meta.url.endsWith("/" + path.basename(process.argv[1])));
if (isDirectRun) {
  main().catch((e) => {
    console.error("[stage] 失败:", e);
    process.exit(1);
  });
}