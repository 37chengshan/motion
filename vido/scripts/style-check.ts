/**
 * 5 风格视觉验证脚本 — 每种风格渲染一帧静图（VidoShort, frame=45，含动画中间态）
 *
 * 用法：node scripts/style-check.ts
 * 输出：out/styles/<style>.png × 5
 * 说明：临时修改 today.json 的 style 字段逐风格渲染后恢复原配置
 */
import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const CONFIG = path.join(ROOT, "src", "data", "today.json");
const BACKUP = path.join(ROOT, "src", "data", ".today-style-check-backup.json");
const OUT_DIR = path.join(ROOT, "out", "styles");

const STYLES = ["minimal-tech", "whiteboard", "sticky-notes", "newspaper", "journal"] as const;

async function main() {
  await copyFile(CONFIG, BACKUP);
  const original = await readFile(CONFIG, "utf-8");
  await mkdir(OUT_DIR, { recursive: true });

  let failed = 0;
  for (const style of STYLES) {
    const cfg = JSON.parse(original);
    cfg.style = style;
    // 保证有可渲染的 blocks（当前配置若是 AI 新闻也有 blocks）
    await writeFile(CONFIG, JSON.stringify(cfg, null, 2), "utf-8");

    const out = path.join(OUT_DIR, `${style}.png`);
    try {
      await execFileAsync(
        "npx",
        [
          "remotion",
          "still",
          "VidoShort",
          out,
          "--frame=45",
          "--log=error",
        ],
        { cwd: ROOT, shell: true, timeout: 300_000 }
      );
      console.log(`[style-check] ${style} → ${out}`);
    } catch (e) {
      failed++;
      console.error(`[style-check] ${style} 渲染失败: ${(e as Error).message?.slice(0, 200)}`);
    }
  }

  // 恢复原配置
  await copyFile(BACKUP, CONFIG);
  const { unlink } = await import("node:fs/promises");
  await unlink(BACKUP).catch(() => {});

  console.log(`[style-check] 完成：${STYLES.length - failed}/${STYLES.length} 风格帧 → out/styles/`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("[style-check] 失败:", e);
  process.exit(1);
});
