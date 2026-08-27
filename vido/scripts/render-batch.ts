/**
 * 批量渲染脚本 — 竖屏 + 横屏一次出片
 *
 * 用法：npm run render:all
 * 输出：
 *  - out/VidoShort.mp4  1080×1920（抖音/小红书）
 *  - out/VidoLong.mp4   1920×1080（B站）
 */
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "node:path";
import { mkdir } from "node:fs/promises";

async function main() {
  const entry = path.resolve(process.cwd(), "src", "index.ts");
  const outDir = path.resolve(process.cwd(), "out");
  await mkdir(outDir, { recursive: true });

  console.log("[render] 打包项目…");
  const serveUrl = await bundle({
    entryPoint: entry,
    onProgress: (p) => {
      if (p % 25 === 0) console.log(`  打包进度 ${p}%`);
    },
  });

  const targets = [
    { id: "VidoShort", file: "video_short.mp4" },
    { id: "VidoLong", file: "video_long.mp4" },
  ];

  for (const target of targets) {
    console.log(`[render] 渲染 ${target.id} → out/${target.file} …`);
    const composition = await selectComposition({
      serveUrl,
      id: target.id,
      inputProps: {},
    });
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: path.join(outDir, target.file),
      inputProps: {},
      onProgress: ({ progress }) => {
        if (Math.round(progress * 100) % 20 === 0) {
          process.stdout.write(`  ${target.id}: ${Math.round(progress * 100)}%\r`);
        }
      },
    });
    console.log(`[render] ✅ ${target.id} 完成`);
  }

  console.log("[render] 全部完成，输出目录：out/");
}

main().catch((e) => {
  console.error("[render] 失败:", e);
  process.exit(1);
});
