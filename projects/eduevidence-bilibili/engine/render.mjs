// render.mjs — API 方式渲染（绕开 CLI 位置参数问题）
// 用法: node render.mjs <compId> <outPath> [concurrency]
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const compId = process.argv[2];
const out = process.argv[3];
const concurrency = process.argv[4] ? parseInt(process.argv[4], 10) : undefined;
if (!compId || !out) {
  console.error("usage: node render.mjs <compId> <out.mp4> [concurrency]");
  process.exit(1);
}

console.log("bundling…");
const bundleResult = await bundle({
  entryPoint: path.join(here, "src/index.ts"),
  onProgress: (p) => {
    if (p % 20 === 0) console.log(`bundle ${p}%`);
  },
});

console.log("selecting composition…");
const composition = await selectComposition({
  serveUrl: bundleResult,
  id: compId,
});
console.log(`frames: ${composition.durationInFrames}, fps: ${composition.fps}, size: ${composition.width}x${composition.height}`);

console.log("rendering…");
await renderMedia({
  composition,
  serveUrl: bundleResult,
  codec: "h264",
  outputLocation: path.resolve(out),
  inputProps: {},
  fps: 60,
  concurrency,
  chromiumOptions: { gl: "angle" },
  onProgress: ({ progress }) => {
    const pct = Math.round(progress * 100);
    if (pct % 5 === 0) console.log(`render ${pct}%`);
  },
});
console.log("DONE", path.resolve(out));
process.exit(0);
