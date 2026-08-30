/**
 * embed-server 客户端（Phase 4）— 调 tools/embed-server（127.0.0.1:8765）
 *
 * 后端：Qwen3-VL-Embedding-2B（GPU 常驻），统一 2048 维归一化向量。
 * 四端点：文本 /embed、图片 /embed-image、视频 /embed-video、混合分段 /embed-segments。
 * 环境变量 EMBED_BASE_URL 可覆盖默认地址（本地开发默认 http://127.0.0.1:8765）。
 *
 * 用法：
 *   const e = new EmbedClient();
 *   await e.text(["a", "b"]);            // number[][]
 *   await e.image("path.jpg");           // number[]
 *   await e.video("path.mp4", 8);        // number[]（内部 ffmpeg 时序抽帧）
 *   await e.segments([{video,frames,text}|{image,text}|{text}, ...]); // number[][]
 */
export interface SegmentInput {
  video?: string;
  image?: string;
  text?: string;
  frames?: number;
}

export class EmbedClient {
  private base: string;

  constructor(base = process.env.EMBED_BASE_URL ?? "http://127.0.0.1:8765") {
    this.base = base.replace(/\/+$/, "");
  }

  private async post<T>(path: string, body: unknown, timeoutMs = 600_000): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(this.base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`embed ${path} HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 健康检查（不触发模型加载） */
  async health(): Promise<{ ok: boolean; loaded: boolean; dim: number } | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(this.base + "/health", { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      return (await res.json()) as { ok: boolean; loaded: boolean; dim: number };
    } catch {
      return null;
    }
  }

  /** 文本向量化（可批量） */
  async text(texts: string[]): Promise<number[][]> {
    const d = await this.post<{ vectors: number[][] }>("/embed", { texts });
    return d.vectors;
  }

  /** 单图向量化 */
  async image(imagePath: string): Promise<number[]> {
    const d = await this.post<{ vector: number[] }>("/embed-image", { image: imagePath });
    return d.vector;
  }

  /** 单视频向量化（内部 ffmpeg 按时间均匀抽帧，绕开视频后端） */
  async video(videoPath: string, frameSampleNum = 8): Promise<number[]> {
    const d = await this.post<{ vector: number[] }>("/embed-video", {
      video: videoPath,
      frame_sample_num: frameSampleNum,
    });
    return d.vector;
  }

  /** 混合分段批量：items 与返回向量一一对应（视频片段用 ffmpeg 时序抽帧） */
  async segments(items: SegmentInput[]): Promise<number[][]> {
    const d = await this.post<{ vectors: number[][] }>("/embed-segments", {
      items: items.map((it) => ({
        ...(it.video ? { video: it.video, frames: it.frames ?? 4 } : {}),
        ...(it.image ? { image: it.image } : {}),
        ...(it.text ? { text: it.text } : {}),
      })),
    });
    return d.vectors;
  }
}
