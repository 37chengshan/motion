/**
 * 向量语义库（Phase 4）— node:sqlite 驱动，零第三方依赖
 *
 * 库路径：d:\motion\data\knowledge.db（已被根 .gitignore 的 *.db 覆盖，不入库）
 * namespaces：news-archive（历史新闻）/ video-blocks（分镜块）/ video-segments（视频时序片段）/ styles（风格）
 *
 * 设计：
 *  - 并发写：PRAGMA journal_mode=WAL + busy_timeout=5000（与 Python 侧兼容）
 *  - 向量存 float32 BLOB，余弦相似度手动计算（数据量 <10 万条时足够；sqlite-vec 可后续替换）
 *  - video_segments 表带 global_start_sec/global_end_sec/prev_seg/next_seg —— 时序上下文，
 *    满足「视频理解不能只看截图，需要前后关系」（审查/检索按时间邻接还原）
 *
 * 用法：
 *   const db = new VectorDB("d:/motion/data/knowledge.db");
 *   db.init();
 *   db.upsert("news-archive", "https://x/1", "文本", [0.1, 0.2]);
 *   db.search("news-archive", [0.1, 0.2], 5);
 *   db.upsertSegment("video-a", 0, 0, 8.2, "frame-000.jpg", null, 1, "描述文本", [..]);
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type Namespace = "news-archive" | "video-blocks" | "video-segments" | "styles";

export interface SearchHit {
  id: number;
  namespace: string;
  sourceRef: string;
  chunkText: string | null;
  meta: Record<string, unknown> | null;
  score: number;
}

export interface SegmentRow {
  id: number;
  videoRef: string;
  segIndex: number;
  globalStartSec: number;
  globalEndSec: number;
  framePath: string | null;
  prevSeg: number | null;
  nextSeg: number | null;
  textDesc: string | null;
  score?: number;
}

function vecToBlob(v: number[]): Buffer {
  return Buffer.from(new Float32Array(v).buffer);
}

function blobToVec(b: Buffer | Uint8Array): number[] {
  return Array.from(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4));
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export class VectorDB {
  private db: DatabaseSync;
  private inited = false;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
  }

  init(): void {
    if (this.inited) return;
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.db.exec("PRAGMA busy_timeout=5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        namespace TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        chunk_text TEXT,
        vector BLOB NOT NULL,
        meta TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_vectors_namespace ON vectors(namespace);
      CREATE TABLE IF NOT EXISTS video_segments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        video_ref TEXT NOT NULL,
        seg_index INTEGER NOT NULL,
        global_start_sec REAL NOT NULL,
        global_end_sec REAL NOT NULL,
        frame_path TEXT,
        prev_seg INTEGER,
        next_seg INTEGER,
        text_desc TEXT,
        vector BLOB,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_segments_video ON video_segments(video_ref, seg_index);
    `);
    this.inited = true;
  }

  /** 通用向量入库（news-archive / video-blocks / styles） */
  upsert(namespace: Namespace, sourceRef: string, text: string | null, vector: number[], meta?: object): void {
    this.init();
    this.db
      .prepare(
        "INSERT INTO vectors (namespace, source_ref, chunk_text, vector, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(namespace, sourceRef, text, vecToBlob(vector), meta ? JSON.stringify(meta) : null, new Date().toISOString());
  }

  /** 向量检索（余弦相似度） */
  search(namespace: Namespace, queryVector: number[], k = 10): SearchHit[] {
    this.init();
    const rows = this.db
      .prepare("SELECT id, namespace, source_ref, chunk_text, meta, vector FROM vectors WHERE namespace = ?")
      .all(namespace) as { id: number; namespace: string; source_ref: string; chunk_text: string | null; meta: string | null; vector: Uint8Array }[];
    return rows
      .map((r) => ({
        id: r.id,
        namespace: r.namespace,
        sourceRef: r.source_ref,
        chunkText: r.chunk_text,
        meta: r.meta ? (JSON.parse(r.meta) as Record<string, unknown>) : null,
        score: cosine(queryVector, blobToVec(r.vector)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /** 视频时序片段入库（video-segments） */
  upsertSegment(
    videoRef: string,
    segIndex: number,
    globalStartSec: number,
    globalEndSec: number,
    framePath: string | null,
    prevSeg: number | null,
    nextSeg: number | null,
    textDesc: string | null,
    vector: number[] | null
  ): void {
    this.init();
    this.db
      .prepare(
        `INSERT INTO video_segments
         (video_ref, seg_index, global_start_sec, global_end_sec, frame_path, prev_seg, next_seg, text_desc, vector, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(videoRef, segIndex, globalStartSec, globalEndSec, framePath, prevSeg, nextSeg, textDesc,
        vector ? vecToBlob(vector) : null, new Date().toISOString());
  }

  /** 取某视频的时序片段序列（按 seg_index 排序，带前后邻接） */
  getSegments(videoRef: string): SegmentRow[] {
    this.init();
    return this.db
      .prepare(
        `SELECT id, video_ref AS videoRef, seg_index AS segIndex,
                global_start_sec AS globalStartSec, global_end_sec AS globalEndSec,
                frame_path AS framePath, prev_seg AS prevSeg, next_seg AS nextSeg,
                text_desc AS textDesc
         FROM video_segments WHERE video_ref = ? ORDER BY seg_index`
      )
      .all(videoRef) as unknown as SegmentRow[];
  }

  /** 片段向量检索（有向量的片段，按余弦排序） */
  searchSegments(queryVector: number[], k = 10): SegmentRow[] {
    this.init();
    const rows = this.db
      .prepare(
        `SELECT id, video_ref AS videoRef, seg_index AS segIndex,
                global_start_sec AS globalStartSec, global_end_sec AS globalEndSec,
                frame_path AS framePath, prev_seg AS prevSeg, next_seg AS nextSeg,
                text_desc AS textDesc, vector
         FROM video_segments WHERE vector IS NOT NULL`
      )
      .all() as unknown as (SegmentRow & { vector: Uint8Array })[];
    return rows
      .map((r) => ({ ...r, vector: undefined, score: cosine(queryVector, blobToVec(r.vector)) }))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, k);
  }

  close(): void {
    this.db.close();
  }
}
