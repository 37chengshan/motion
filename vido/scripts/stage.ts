/**
 * 阶段断点 — 定时任务幂等续跑的状态簿（out/.stage.json）
 *
 * 每个工作流按场次/选题记录已完成阶段，重入时跳过已完成阶段。
 * 阶段顺序约定（vido-ai-news）：research → score → tts → timeline → gen → render → review
 *
 * 用法：
 *   node scripts/stage.ts get <key>                 # 输出已完成阶段（逗号分隔）
 *   node scripts/stage.ts done <key> <stage>        # 标记阶段完成
 *   node scripts/stage.ts reset <key>               # 清空
 *   node scripts/stage.ts next <key> <stage1,stage2,...>  # 输出第一个未完成的阶段（供流程判断）
 *
 * key 示例：morning / evening / github-<repo> / repost-<batchId>
 */
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd(); // vido/
const STAGE_PATH = path.join(ROOT, "out", ".stage.json");

type StageMap = Record<string, string[]>;

async function readStages(): Promise<StageMap> {
  try {
    const raw = JSON.parse(await readFile(STAGE_PATH, "utf-8"));
    return typeof raw === "object" && raw !== null ? raw : {};
  } catch {
    return {};
  }
}

async function writeStages(map: StageMap): Promise<void> {
  await mkdir(path.dirname(STAGE_PATH), { recursive: true });
  const tmp = STAGE_PATH + ".tmp";
  await writeFile(tmp, JSON.stringify(map, null, 2), "utf-8");
  await rename(tmp, STAGE_PATH);
}

async function main() {
  const [action, key, arg3] = process.argv.slice(2);
  if (!action || !key) {
    console.error("用法：node scripts/stage.ts <get|done|reset|next> <key> [stage]");
    process.exit(1);
  }
  const stages = await readStages();
  const list = stages[key] ?? [];

  switch (action) {
    case "get": {
      console.log(list.join(","));
      break;
    }
    case "done": {
      if (!arg3) {
        console.error("[stage] done 需要阶段名");
        process.exit(1);
      }
      if (!list.includes(arg3)) list.push(arg3);
      stages[key] = list;
      await writeStages(stages);
      console.log(`[stage] ${key} 完成阶段：${list.join(" → ")}`);
      break;
    }
    case "reset": {
      delete stages[key];
      await writeStages(stages);
      console.log(`[stage] ${key} 已清空`);
      break;
    }
    case "next": {
      const order = (arg3 ?? "").split(",").filter(Boolean);
      const done = new Set(list);
      const next = order.find((s) => !done.has(s));
      console.log(next ?? "");
      if (!next) console.log(`[stage] ${key} 全部阶段已完成`);
      break;
    }
    default: {
      console.error(`[stage] 未知动作：${action}`);
      process.exit(1);
    }
  }
}

main().catch((e) => {
  console.error("[stage] 失败:", e);
  process.exit(1);
});
