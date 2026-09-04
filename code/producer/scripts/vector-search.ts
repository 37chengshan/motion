/**
 * 向量检索（Phase 4 接入）— 查询文本/图片/视频 → knowledge.db top-k
 *
 * 用法（producer/ 下）：
 *   # 文本查视频时序片段（最常用：描述 → 找到语义匹配的视频段）
 *   node scripts/vector-search.ts --namespace video-segments --text "模型发布"
 *   # 文本查新闻档案
 *   node scripts/vector-search.ts --namespace news-archive --text "OpenAI"
 *   # 图片检索（找语义相似的已入库素材）
 *   node scripts/vector-search.ts --image media/hero.png
 *   # 视频检索（整段视频找相似）
 *   node scripts/vector-search.ts --video out/video_short.mp4 --k 5
 *
 * 环境变量：EMBED_BASE_URL；VECTOR_DB
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { EmbedClient } from "../src/lib/embed-client.ts";
import { VectorDB, type Namespace } from "../src/lib/vector-db.ts";

const DB_PATH = process.env.VECTOR_DB ?? "d:/motion/data/knowledge.db";
const NAMESPACES: Namespace[] = ["news-archive", "video-blocks", "video-segments", "styles"];

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback = "") => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };

  const ns = (get("--namespace", "video-segments") as Namespace);
  if (!NAMESPACES.includes(ns)) {
    console.error("[search] --namespace 只允许 " + NAMESPACES.join("|"));
    process.exit(1);
  }
  const k = parseInt(get("--k", "5"), 10);
  const text = get("--text");
  const image = get("--image");
  const video = get("--video");
  const inputs = [text ? "text" : null, image ? "image" : null, video ? "video" : null].filter(Boolean);
  if (inputs.length !== 1) {
    console.error("[search] --text / --image / --video 三选一");
    process.exit(1);
  }

  const client = new EmbedClient();
  const h = await client.health();
  if (!h || !h.ok) {
    console.error("[search] embed-server 不可达，先启动：cd tools/embed-server && python manage.py start");
    process.exit(1);
  }

  let qv: number[];
  if (text) {
    qv = (await client.text([text]))[0];
  } else if (image) {
    if (!existsSync(image)) throw new Error("图片不存在：" + image);
    qv = await client.image(image);
  } else {
    if (!existsSync(video!)) throw new Error("视频不存在：" + video);
    qv = await client.video(video!, 8);
  }
  console.log(`[search] 查询向量 dim=${qv.length}，检索 ${ns} top-${k} ...\n`);

  const db = new VectorDB(DB_PATH);
  db.init();

  if (ns === "video-segments") {
    const hits = db.searchSegments(qv, k);
    if (!hits.length) {
      console.log("[search] 无结果（video-segments 空或没有向量，先跑 vector-ingest --video）");
      process.exit(0);
    }
    hits.forEach((r, i) => {
      console.log(
        `  ${i + 1}. [${r.score?.toFixed(3)}] ${r.videoRef} seg#${r.segIndex} ` +
          `${r.globalStartSec.toFixed(1)}s–${r.globalEndSec.toFixed(1)}s` +
          (r.prevSeg !== null ? ` prev=${r.prevSeg}` : "") +
          (r.nextSeg !== null ? ` next=${r.nextSeg}` : "") +
          (r.textDesc ? ` | ${r.textDesc.slice(0, 60)}` : "")
      );
    });
  } else {
    const hits = db.search(ns, qv, k);
    if (!hits.length) {
      console.log("[search] 无结果（" + ns + " 为空，先入库）");
      process.exit(0);
    }
    hits.forEach((r, i) => {
      console.log(
        `  ${i + 1}. [${r.score.toFixed(3)}] ${r.sourceRef}` +
          (r.chunkText ? ` | ${r.chunkText.slice(0, 80)}` : "")
      );
    });
  }

  db.close();
}

const isDirectRun =
  process.argv[1] &&
  (import.meta.url === new URL("file://" + path.resolve(process.argv[1])).href ||
    import.meta.url.endsWith("/" + path.basename(process.argv[1])));
if (isDirectRun) {
  main().catch((e) => {
    console.error("[search] 失败:", e);
    process.exit(1);
  });
}
