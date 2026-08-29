# -*- coding: utf-8 -*-
"""Qwen3-VL-Embedding 多模态常驻推理服务（127.0.0.1:8765）

端点：
  GET  /health          健康检查（不触发模型加载）
  POST /embed           文本向量化 {texts:[...]} -> {vectors:[[...]], dim}
  POST /embed-image     图片向量化 {image: <本地路径>} -> {vector:[...], dim}
  POST /embed-video     视频向量化 {video: <本地路径>, frame_sample_num: 8} -> {vector:[...], dim}
  POST /embed-segments  片段批量（video-segments 用时序文本 + 代表帧，融合或独立向量）

懒加载：首次实际请求才加载模型（冷启动 1-3 分钟，之后常驻内存）。
多模态：Qwen3-VL-Embedding-2B（encode_text / encode_image / encode_video），
  视频内部帧采样自带时间维度 —— 满足「视频理解不能只看截图，需要前后关系」。

启动：
  uv run --project d:/motion/tools/embed-server uvicorn server:app --host 127.0.0.1 --port 8765
"""
import os

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

MODEL_DIR = os.environ.get("EMBED_MODEL_DIR", r"D:\motion\models\Qwen3-VL-Embedding-2B")
DIM = int(os.environ.get("EMBED_DIM", "2048"))

app = FastAPI(title="embed-server")
_model = None
_tokenizer = None


class EmbedRequest(BaseModel):
    texts: list[str]
    batch_size: int = 32


class EmbedImageRequest(BaseModel):
    image: str  # 本地图片路径


class EmbedVideoRequest(BaseModel):
    video: str  # 本地视频路径
    frame_sample_num: int = 8


class SegmentsRequest(BaseModel):
    """片段级批量：每片段 {text? 描述, image? 代表帧路径, video? 片段路径}
    有 image/video 时走视觉嵌入；仅 text 时走文本嵌入；多个输入时输出独立向量数组
    """
    items: list[dict]
    batch_size: int = 16


class VectorResponse(BaseModel):
    vector: list[float]
    dim: int


class VectorsResponse(BaseModel):
    vectors: list[list[float]]
    dim: int


def get_model():
    global _model, _tokenizer
    if _model is None:
        from transformers import AutoModel, AutoTokenizer

        print(f"[embed] loading model from {MODEL_DIR} ...", flush=True)
        _tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR, trust_remote_code=True)
        _model = AutoModel.from_pretrained(MODEL_DIR, trust_remote_code=True).eval()
        print("[embed] model loaded", flush=True)
    return _model, _tokenizer


@app.get("/health")
def health():
    return {
        "ok": True,
        "model": os.path.basename(MODEL_DIR),
        "dim": DIM,
        "loaded": _model is not None,
        "modalities": ["text", "image", "video"],
    }


@app.post("/embed", response_model=VectorsResponse)
def embed(req: EmbedRequest):
    model, tokenizer = get_model()
    vecs = model.encode_text(tokenizer, req.texts, batch_size=req.batch_size)
    vectors = vecs.cpu().tolist() if hasattr(vecs, "cpu") else [v.tolist() for v in vecs]
    return VectorsResponse(vectors=vectors, dim=len(vectors[0]))


@app.post("/embed-image", response_model=VectorResponse)
def embed_image(req: EmbedImageRequest):
    if not os.path.exists(req.image):
        raise HTTPException(404, f"image not found: {req.image}")
    model, _ = get_model()
    vec = model.encode_image(req.image)
    vector = vec.cpu().tolist() if hasattr(vec, "cpu") else vec.tolist()
    return VectorResponse(vector=vector, dim=len(vector))


@app.post("/embed-video", response_model=VectorResponse)
def embed_video(req: EmbedVideoRequest):
    if not os.path.exists(req.video):
        raise HTTPException(404, f"video not found: {req.video}")
    model, _ = get_model()
    vec = model.encode_video(req.video, frame_sample_num=req.frame_sample_num)
    vector = vec.cpu().tolist() if hasattr(vec, "cpu") else vec.tolist()
    return VectorResponse(vector=vector, dim=len(vector))


@app.post("/embed-segments", response_model=VectorsResponse)
def embed_segments(req: SegmentsRequest):
    """片段级多模态嵌入：返回与 items 等长的向量数组（每片段一个向量）"""
    model, tokenizer = get_model()
    vectors = []
    for item in req.items:
        if item.get("video") and os.path.exists(item["video"]):
            v = model.encode_video(item["video"], frame_sample_num=item.get("frames", 8))
        elif item.get("image") and os.path.exists(item["image"]):
            v = model.encode_image(item["image"])
        elif item.get("text"):
            v = model.encode_text(tokenizer, [item["text"]])
        else:
            raise HTTPException(400, f"segment needs text/image/video: {item}")
        vec = v.cpu().tolist() if hasattr(v, "cpu") else v.tolist()
        vectors.append(vec[0] if vec and isinstance(vec[0], list) else vec)
    return VectorsResponse(vectors=vectors, dim=len(vectors[0]) if vectors else DIM)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="127.0.0.1", port=8765)
