/**
 * 反馈与教训记录（Phase 6）— 只追加 + 读，低危待人工确认后才 bump 版本
 *
 * 用途：batch 内强制 review 的结果、盲测结果、用户反馈 → 统一记录到
 *   runs/feedback/lessons.json
 * 触发：review fail / 盲测漏项 / 用户反馈 / 渠道降级
 *
 * 用法：
 *   node scripts/feedback.ts add --source review --severity high \
 *     --issue-type layout --desc "字幕条遮挡标题" --evidence "frame-12.png" \
 *     [--run-id ai-news-morning-2026-08-29]
 *   node scripts/feedback.ts list [--status pending_confirm] [--source review]
 *   node scripts/feedback.ts confirm <id>
 *   node scripts/feedback.ts reject <id>
 *
 * 版本化约定：confirmed 的条目才触发 handbook/prompt 版本 bump（人工确认）
 */
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const LESSONS_PATH = path.join(ROOT, "runs", "feedback", "lessons.json");

export type LessonSource = "review" | "blindtest" | "user" | "channel-degraded";
export type IssueType = "layout" | "source-miss" | "tone" | "timing" | "channel";
export type LessonStatus = "pending_confirm" | "confirmed" | "rejected";

export interface LessonEntry {
  id: string;
  date: string;
  run_id?: string;
  source: LessonSource;
  severity: "high" | "medium" | "low";
  issue_type: IssueType;
  description: string;
  evidence?: string;
  status: LessonStatus;
  action?: {
    target: string; // 如 "handbook:ai-news@v2" / "prompt:ai-subagent@v3"
    applied_run?: string;
  };
  created_at: string;
}

export interface LessonsFile {
  schema_version: number;
  entries: LessonEntry[];
}

async function load(): Promise<LessonsFile> {
  try {
    const raw = JSON.parse(await readFile(LESSONS_PATH, "utf-8"));
    if (raw && Array.isArray(raw.entries)) return raw;
  } catch {
    /* 不存在或损坏 */
  }
  return { schema_version: 1, entries: [] };
}

async function save(file: LessonsFile): Promise<void> {
  await mkdir(path.dirname(LESSONS_PATH), { recursive: true });
  const tmp = LESSONS_PATH + ".tmp";
  await writeFile(tmp, JSON.stringify(file, null, 2), "utf-8");
  await rename(tmp, LESSONS_PATH);
}

function nextId(entries: LessonEntry[]): string {
  return "L" + String(entries.length + 1).padStart(4, "0");
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
  };
  const action = args[0];

  const file = await load();

  if (action === "add") {
    const entry: LessonEntry = {
      id: nextId(file.entries),
      date: new Date().toISOString().slice(0, 10),
      run_id: get("--run-id"),
      source: (get("--source") ?? "review") as LessonSource,
      severity: (get("--severity") ?? "medium") as LessonEntry["severity"],
      issue_type: (get("--issue-type") ?? "layout") as IssueType,
      description: get("--desc") ?? "",
      evidence: get("--evidence"),
      status: "pending_confirm",
      created_at: new Date().toISOString(),
    };
    if (!entry.description) {
      console.error("[feedback] --desc 必填");
      process.exit(1);
    }
    file.entries.push(entry);
    await save(file);
    console.log(`[feedback] 已记录 ${entry.id}（${entry.source}/${entry.issue_type}/${entry.severity}）: ${entry.description}`);
    return;
  }

  if (action === "list") {
    const status = get("--status");
    const source = get("--source");
    const rows = file.entries.filter(
      (e) => (!status || e.status === status) && (!source || e.source === source)
    );
    for (const e of rows) {
      console.log(
        `${e.id}\t[${e.status}]\t${e.source}\t${e.issue_type}\t${e.severity}\t${e.date}\t${e.description}`
      );
    }
    console.log(`--- 共 ${rows.length} 条`);
    return;
  }

  if (action === "confirm" || action === "reject") {
    const id = args[1];
    const entry = file.entries.find((e) => e.id === id);
    if (!entry) {
      console.error(`[feedback] 未找到 ${id}`);
      process.exit(1);
    }
    entry.status = action === "confirm" ? "confirmed" : "rejected";
    if (action === "confirm" && get("--target")) {
      entry.action = { target: get("--target")!, applied_run: get("--applied-run") };
    }
    await save(file);
    console.log(`[feedback] ${id} → ${entry.status}`);
    return;
  }

  console.error("用法：feedback.ts add|list|confirm|reject（详见文件头注释）");
  process.exit(1);
}

const isDirectRun =
  process.argv[1] &&
  (import.meta.url === new URL("file://" + path.resolve(process.argv[1])).href ||
    import.meta.url.endsWith("/" + path.basename(process.argv[1])));
if (isDirectRun) {
  main().catch((e) => {
    console.error("[feedback] 失败:", e);
    process.exit(1);
  });
}
