/**
 * 素材编排器（视觉三轨闭合）— 读 content.json 的 blocks[].media 需求，批量产出素材并回填 src
 *
 * 三轨分派：
 *  - illustration  → AI 底图轨：AIPING 文生图（模型 IMAGE_MODEL_HERO，默认 doubao-seedream-4.0）
 *  - figure/leaderboard → 数据可视化轨：AIPING 文生图（模型 IMAGE_MODEL_DIAGRAM，默认 kling-v2.1）
 *  - screenshot    → 官方截图轨：从 --screenshots-dir 按 query 关键词匹配本地文件导入
 *                    （截图经 CDP 下载，不在本脚本内抓取；匹配不到则跳过，渲染降级无素材页）
 *
 * 环境变量（只从环境读取，不落盘）：
 *   AIPING_API_KEY / AIPING_BASE_URL / AIPING_FIXTURE（透传 media-adapter）
 *   IMAGE_MODEL_HERO / IMAGE_MODEL_DIAGRAM / IMAGE_MODEL_BG
 *
 * 用法（producer/ 下）：
 *   node scripts/media-orchestrate.ts --run-dir runs/2026-08-30/ai-news --date 2026-08-30
 *   node scripts/media-orchestrate.ts --run-dir ... --date ... --dry-run        # 只打印计划
 *   node scripts/media-orchestrate.ts --run-dir ... --date ... --screenshots-dir runs/.../screenshots
 */
import { mkdir, readFile, writeFile, rename, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { runDirPaths } from "../src/data/timeline.ts";
import type { VideoConfig } from "../src/data/types.ts";
import { generateMedia, importMedia } from "./media-adapter.ts";

const ROOT = process.cwd();

function fail(msg: string): never {
  console.error("[media-orchestrate] " + msg);
  process.exit(1);
}

function parseArgs(): { get: (f: string, fb: string) => string; has: (f: string) => boolean } {
  const args = process.argv.slice(2);
  const get = (f: string, fb: string) => {
    const i = args.indexOf(f);
    return i >= 0 && args[i + 1] ? args[i + 1] : fb;
  };
  return { get, has: (f: string) => args.includes(f) };
}

interface MediaNeed {
  blockIndex: number;
  kind: "illustration" | "screenshot" | "figure" | "leaderboard";
  prompt?: string;
  query?: string;
  caption?: string;
}

/** 从 content.json 收集 src 为空的 media 需求 */
function collectNeeds(config: VideoConfig): MediaNeed[] {
  const needs: MediaNeed[] = [];
  config.blocks.forEach((b, i) => {
    if (!b.media || b.media.src) return;
    needs.push({
      blockIndex: i,
      kind: b.media.kind as MediaNeed["kind"],
      prompt: b.media.prompt,
      query: b.media.query,
      caption: b.media.caption,
    });
  });
  return needs;
}

/** 截图目录里按 query 关键词匹配文件（去掉扩展名的文件名包含任一关键词即命中） */
async function findScreenshot(dir: string, query: string): Promise<string | null> {
  if (!existsSync(dir)) return null;
  const files = await readdir(dir);
  const keys = (query ?? "").split(/[\s,，/]+/).filter(Boolean);
  for (const f of files) {
    if (!/\.(png|jpe?g|webp)$/i.test(f)) continue;
    const base = path.basename(f).replace(/\.[^.]+$/, "").toLowerCase();
    if (keys.some((k) => base.includes(k.toLowerCase()))) return path.join(dir, f);
  }
  return null;
}

async function main() {
  const { get, has } = parseArgs();
  const runDirFlag = get("--run-dir", "");
  if (!runDirFlag) fail("必须提供 --run-dir（如 runs/2026-08-30/ai-news）");
  const runDir = path.resolve(ROOT, runDirFlag);
  const runPaths = runDirPaths(runDir);

  const date = get("--date", "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail("--date 必须为 YYYY-MM-DD");
  const dryRun = has("--dry-run");
  const size = get("--size", "1024x1024");
  const screenshotsDir = get("--screenshots-dir", "");

  if (!existsSync(runPaths.configPath)) {
    fail("缺少 content.json：" + path.relative(ROOT, runPaths.configPath) + "（先跑 generate-content）");
  }
  const config = JSON.parse(await readFile(runPaths.configPath, "utf-8")) as VideoConfig;

  const needs = collectNeeds(config);
  if (needs.length === 0) {
    console.log("[media-orchestrate] content.json 无待编排素材需求（全部已回填或未声明）");
    return;
  }

  const heroModel = process.env.IMAGE_MODEL_HERO || "doubao-seedream-4.0";
  const diagramModel = process.env.IMAGE_MODEL_DIAGRAM || "kling-v2.1";
  const mediaDir = path.join(runDir, "media");
  if (!dryRun) await mkdir(mediaDir, { recursive: true });

  console.log("[media-orchestrate] 待编排 " + needs.length + " 条（hero=" + heroModel + " diagram=" + diagramModel + "）");
  console.log("[media-orchestrate] 输出目录 " + path.relative(ROOT, mediaDir));

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  const srcMap: Record<number, string> = {};
  /** 同 prompt 复用（模型常给 title/内容块相同 media 需求，避免重复生成浪费） */
  const byPrompt = new Map<string, string>();

  for (let n = 0; n < needs.length; n++) {
    const need = needs[n];
    const label = "block[" + need.blockIndex + "]." + need.kind;
    try {
      let relPath = "";

      if (need.kind === "illustration") {
        const prompt = need.prompt?.trim();
        if (!prompt) throw new Error("缺少 prompt");
        const cached = byPrompt.get(prompt);
        if (cached) {
          relPath = cached;
          console.log("  [复用] " + label + " ← " + cached);
        } else {
          const file = need.blockIndex + "-hero-" + (n + 1) + ".png";
          if (dryRun) {
            console.log("  [计划] " + label + " → AIPING " + heroModel + " " + size + "：「" + prompt.slice(0, 40) + "…」");
          } else {
            await generateMedia({
              prompt,
              model: heroModel,
              size,
              out: path.join(path.relative(ROOT, runDir), "media", file).replace(/\\/g, "/"),
              kind: "image",
            });
            relPath = path.join("runs", date, path.basename(runDir), "media", file).replace(/\\/g, "/");
            byPrompt.set(prompt, relPath);
            console.log("  [生成] " + label + " ✓ " + relPath);
          }
        }
      } else if (need.kind === "figure" || need.kind === "leaderboard") {
        const prompt = need.prompt?.trim();
        if (!prompt) throw new Error("缺少 prompt");
        const cached = byPrompt.get(prompt);
        if (cached) {
          relPath = cached;
          console.log("  [复用] " + label + " ← " + cached);
        } else {
          const file = need.blockIndex + "-diagram-" + (n + 1) + ".png";
          if (dryRun) {
            console.log("  [计划] " + label + " → AIPING " + diagramModel + " " + size + "：「" + prompt.slice(0, 40) + "…」");
          } else {
            await generateMedia({
              prompt,
              model: diagramModel,
              size,
              out: path.join(path.relative(ROOT, runDir), "media", file).replace(/\\/g, "/"),
              kind: "image",
            });
            relPath = path.join("runs", date, path.basename(runDir), "media", file).replace(/\\/g, "/");
            byPrompt.set(prompt, relPath);
            console.log("  [生成] " + label + " ✓ " + relPath);
          }
        }
      } else {
        // screenshot：本地截图目录匹配导入
        const query = need.query?.trim() || need.prompt?.trim() || "";
        if (!screenshotsDir) {
          console.warn("  [跳过] " + label + "：未提供 --screenshots-dir（截图需 CDP 下载后导入）");
          skipped++;
          continue;
        }
        const hit = await findScreenshot(screenshotsDir, query);
        if (!hit) {
          console.warn("  [跳过] " + label + "：截图目录无匹配（query=「" + query.slice(0, 30) + "」）");
          skipped++;
          continue;
        }
        if (dryRun) {
          console.log("  [计划] " + label + " → import " + path.relative(ROOT, hit));
        } else {
          const file = need.blockIndex + "-shot-" + (n + 1) + path.extname(hit);
          const dstAbs = path.join(mediaDir, file);
          const { copyFile } = await import("node:fs/promises");
          await copyFile(hit, dstAbs);
          await importMedia({ file: dstAbs, license: "official-screenshot", kind: "image", provider: "external" });
          relPath = path.join("runs", date, path.basename(runDir), "media", file).replace(/\\/g, "/");
          console.log("  [导入] " + label + " ✓ " + relPath);
        }
      }

      if (dryRun) {
        ok++;
        continue;
      }
      if (relPath) {
        srcMap[need.blockIndex] = relPath;
        ok++;
      }
    } catch (e) {
      failed++;
      console.error("  [失败] " + label + "：" + (e as Error).message);
    }
  }

  // 回填 src 并原子写回 content.json
  if (!dryRun && Object.keys(srcMap).length > 0) {
    config.blocks.forEach((b, i) => {
      if (srcMap[i] && b.media) b.media.src = srcMap[i];
    });
    const tmp = runPaths.configPath + ".tmp";
    await writeFile(tmp, JSON.stringify(config, null, 2), "utf-8");
    await rename(tmp, runPaths.configPath);
    console.log("[media-orchestrate] 已回填 " + Object.keys(srcMap).length + " 个 src → " + path.relative(ROOT, runPaths.configPath));
  }

  console.log(
    "[media-orchestrate] 完成：" + ok + " 成功 / " + skipped + " 跳过 / " + failed + " 失败" +
      (dryRun ? "（dry-run 未写入）" : "")
  );
  if (failed > 0) process.exit(2);
}

main().catch((e) => {
  console.error("[media-orchestrate] 失败:", e);
  process.exit(1);
});
