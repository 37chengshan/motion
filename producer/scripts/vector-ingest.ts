/**
 * 向量入库（Phase 4 接入）— 素材 → embed-server → knowledge.db
 *
 * 核心能力：视频按时间切段入库（video-segments），每段一个向量 + 时序邻接
 * （prev_seg/next_seg），满足「视频入库不能只看截图，需要理解前后时序关系」。
 * 图片/文本走通用命名空间（news-archive / styles / video-blocks）。
 *
 * 用法（producer/ 下）：
 *   # 视频时序分段入库（每段均匀覆盖，默认 4 段）
 *   node scripts/vector-ingest.ts --video out/ai_news_long.mp4 --ref ai_news_long --segments 4 [--desc "AI 新闻长片"]
 *   # 整视频单向量入库
 *   node scripts/vector-ingest.ts --video out/video_short.mp4 --ref video_short --whole
 *   # 图片入库
 *   node scripts/vector-ingest.ts --image media/hero.png --ref hero-20260829 --namespace news-archive
 *   # 文本入库
 *   node scripts/vector-ingest.ts --text "OpenAI 发布 GPT-6" --ref txt-1 --namespace news-archive
 *   # 离线验证（不连 embed-server）：--offline 用随机向量占位（结构验证用）
 *
 * 环境变量：EMBED_BASE_URL（默认 http://127.0.0.1:8765）；VECTOR_DB（默认 d:/motion/data/knowledge.db）
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { EmbedClient } from "../src/lib/embed-client.ts";
import { VectorDB, type Namespace } from "../src/lib/vector-db.ts";

const ROOT = process.cwd();
const DB_PATH = process.env.VECTOR_DB ?? "d:/motion/data/knowledge.db";
const NAMESPACES: Namespace[] = ["news-archive", "video-blocks", "video-segments", "styles"];

function probeDuration(video: string): number {
  const r = spawnSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", video,
  ], { encoding: "utf-8", timeout: 30_000 });
  const dur = parseFloat((r.stdout ?? "").trim());
  if (isNaN(dur) || dur <= 0) throw new Error("ffprobe 无法获取视频时长：" + video);
  return dur;
}

function pseudoVector(seed: number): number[] {
  // 离线占位：确定性伪向量（仅结构验证，不用于语义检索）
  const v: number[] = [];
  let x = seed * 2654435761 + 1;
  for (let i = 0; i < 8; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    v.push(((x % 1000) / 500) - 1);
  }
  return v;
}

async function ingestVideo(db: VectorDB, client: EmbedClient, opts: {
  video: string; ref: string; segments: number; whole: boolean; desc?: string; offline?: boolean;
}) {
  if (!existsSync(opts.video)) throw new Error("视频不存在：" + opts.video);
  const dur = probeDuration(opts.video);

  if (opts.whole) {
    // 整视频单向量 → video-segments 也可（seg_index=0，全长一段）
    const vec = opts.offline ? pseudoVector(1) : await client.video(opts.video, 8);
    db.upsertSegment(opts.ref, 0, 0, dur, null, null, null, opts.desc ?? null, vec);
    console.log(`[ingest] ${opts.ref} 整视频向量已入库（${dur.toFixed(1)}s, dim=${vec.length}）`);
    return;
  }

  const n = Math.max(2, opts.segments);
  // 每段 [start, end] 均匀切分，段中点作为片段代表时刻
  const segLen = dur / n;
  const items = Array.from({ length: n }, (_, i) => ({
    video: opts.video,
    frames: 3, // 每段 3 帧（时序内采样），控制 token 开销
    text: `${opts.desc ? opts.desc + "；" : ""}第 ${i + 1}/${n} 段（${(i * segLen).toFixed(1)}s–${((i + 1) * segLen).toFixed(1)}s）`,
  }));
  console.log(`[ingest] ${opts.ref} 切 ${n} 段 × 3 帧/段，调 embed-server ...`);
  const vecs = opts.offline
    ? items.map((_, i) => pseudoVector(i + 2))
    : await client.segments(items);
  if (vecs.length !== n) throw new Error(`embed-segments 返回 ${vecs.length} 个向量，期望 ${n}`);

  for (let i = 0; i < n; i++) {
    db.upsertSegment(
      opts.ref, i,
      i * segLen, (i + 1) * segLen,
      null,
      i > 0 ? i - 1 : null,   // prev_seg
      i < n - 1 ? i + 1 : null, // next_seg
      items[i].text, vecs[i]
    );
    console.log(`  seg[${i}] ${(i * segLen).toFixed(1)}s–${((i + 1) * segLen).toFixed(1)}s vec=${vecs[i].length} dim`);
  }
  console.log(`[ingest] ${opts.ref} ${n} 段已入库（含时序邻接链）`);
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback = "") => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const has = (flag: string) => args.includes(flag);

  const video = get("--video");
  const image = get("--image");
  const text = get("--text");
  const ref = get("--ref", "");
  const ns = (get("--namespace", "news-archive") as Namespace);
  if (!NAMESPACES.includes(ns)) {
    console.error("[ingest] --namespace 只允许 " + NAMESPACES.join("|"));
    process.exit(1);
  }
  const segments = parseInt(get("--segments", "4"), 10);
  const whole = has("--whole");
  const offline = has("--offline");
  const desc = get("--desc") || undefined;

  if (!ref) {
    console.error("[ingest] 必须提供 --ref（素材唯一标识，检索用）");
    process.exit(1);
  }
  const inputs = [video ? "video" : null, image ? "image" : null, text ? "text" : null].filter(Boolean);
  if (inputs.length !== 1) {
    console.error("[ingest] --video / --image / --text 三选一");
    process.exit(1);
  }

  const db = new VectorDB(DB_PATH);
  db.init();

  if (!offline) {
    const client = new EmbedClient();
    const h = await client.health();
    if (!h || !h.ok) {
      console.error("[ingest] embed-server 不可达，先启动：cd tools/embed-server && python manage.py start");
      process.exit(1);
    }
    console.log(`[ingest] embed-server 在线（loaded=${h.loaded} dim=${h.dim}）`);
  }

  if (video) {
    await ingestVideo(db, new EmbedClient(), { video, ref, segments, whole, desc, offline });
  } else if (image) {
    if (!existsSync(image)) throw new Error("图片不存在：" + image);
    const vec = offline ? pseudoVector(9) : await new EmbedClient().image(image);
    db.upsert(ns, ref, desc ?? null, vec, { kind: "image", path: image });
    console.log(`[ingest] ${ref} 图片向量已入库（${ns}, dim=${vec.length}）`);
  } else if (text) {
    const vec = offline ? [pseudoVector(10)] : await new EmbedClient().text([text]);
    db.upsert(ns, ref, text, vec[0], { kind: "text" });
    console.log(`[ingest] ${ref} 文本向量已入库（${ns}, dim=${vec[0].length}）`);
  }

  db.close();
  console.log("[ingest] 完成");
}

const isDirectRun =
  process.argv[1] &&
  (import.meta.url === new URL("file://" + path.resolve(process.argv[1])).href ||
    import.meta.url.endsWith("/" + path.basename(process.argv[1])));
if (isDirectRun) {
  main().catch((e) => {
    console.error("[ingest] 失败:", e);
    process.exit(1);
  });
}
