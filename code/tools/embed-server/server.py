# -*- coding: utf-8 -*-
"""Qwen3-VL-Embedding 多模态常驻推理服务（127.0.0.1:8765）

端点：
  GET  /health          健康检查（不触发模型加载）
  POST /embed           文本向量化 {texts:[...]} -> {vectors:[[...]], dim}
  POST /embed-image     图片向量化 {image: <本地路径>} -> {vector:[...], dim}
  POST /embed-video     视频向量化 {video: <本地路径>, frame_sample_num: 8} -> {vector:[...], dim}
  POST /embed-segments  片段批量（video-segments 用时序文本 + 代表帧，融合或独立向量）

懒加载：首次实际请求才加载模型（冷启动 1-3 分钟，之后常驻内存）。
多模态：Qwen3-VL-Embedding-2B —— 官方 Qwen3VLEmbedder.process() 支持
  text / image / video 任意组合，视频内部按 fps 帧采样 —— 满足
  「视频理解不能只看截图，需要前后关系」的时序语义。

启动：
  .venv3/Scripts/python.exe -m uvicorn server:app --host 127.0.0.1 --port 8765
"""
import os
import subprocess
import sys
import tempfile

# 视频读取后端：decord 不支持 file:// 前缀，torchcodec 的 DLL 在本机缺依赖，
# torchvision 0.26 移除了 read_video —— 统一改用「ffmpeg 抽帧 → 帧路径列表」方案：
# 给 process 传 video 帧列表会走 fetch_image（支持 file:// 前缀），完全绕开视频后端。
os.environ.setdefault("FORCE_QWENVL_VIDEO_READER", "decord")

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

MODEL_DIR = os.environ.get("EMBED_MODEL_DIR", r"D:\motion\models\Qwen3-VL-Embedding-2B")
DIM = int(os.environ.get("EMBED_DIM", "2048"))

# 官方 Qwen3VLEmbedder 实现位于模型目录 scripts/ 下
SCRIPTS_DIR = os.path.join(MODEL_DIR, "scripts")
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

app = FastAPI(title="embed-server")
_embedder = None


class EmbedRequest(BaseModel):
    texts: list[str]
    batch_size: int = 32


class EmbedImageRequest(BaseModel):
    image: str  # 本地图片路径


class EmbedVideoRequest(BaseModel):
    video: str  # 本地视频路径
    frame_sample_num: int = 8  # 采样帧数（官方 max_frames）


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


def get_embedder():
    global _embedder
    if _embedder is None:
        from qwen3_vl_embedding import Qwen3VLEmbedder

        print(f"[embed] loading model from {MODEL_DIR} ...", flush=True)
        _embedder = Qwen3VLEmbedder(model_name_or_path=MODEL_DIR)
        # 启用 transformers 视频每帧像素上限：默认关闭时视频分支会耗尽整段
        # 视频的像素预算，短片段 token 开销接近长视频（实测 4 帧前向 74.5s）；
        # 开启后前向耗时减半（32.6s），不影响时序语义。
        try:
            _embedder.processor.cap_pixels_per_frame = True
            print("[embed] video cap_pixels_per_frame=True", flush=True)
        except AttributeError:
            print("[embed] warn: cap_pixels_per_frame not supported, skip", flush=True)
        print("[embed] model loaded", flush=True)
    return _embedder


def _to_list(t) -> list:
    return t.cpu().tolist() if hasattr(t, "cpu") else t.tolist()


def _extract_frames(video: str, n: int) -> list[str]:
    """ffmpeg 从视频按时间均匀抽 n 帧 → 返回帧路径列表（走 fetch_image，绕开视频后端）
    时间点 t_i = (i+0.5) * dur / n —— 全片均匀覆盖，保持「前后时序关系」语义。
    用 -ss input seek（不解码无关帧），单进程多输出，耗时与视频时长基本无关
    （实测 106s 1080p 抽 8 帧 ≈0.4s，比 fps 滤镜方案快 7.5 倍）。
    """
    tmpdir = tempfile.mkdtemp(prefix="embed_frames_")
    # 探测时长
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", video],
        capture_output=True, text=True, timeout=30,
    )
    try:
        dur = float(probe.stdout.strip())
    except ValueError:
        dur = 0.0
    if dur <= 0:
        raise HTTPException(400, f"cannot probe video duration: {video}")
    n = max(2, int(n))
    # 降分辨率抽帧：video 分支只带 total_pixels（无每帧 max_pixels cap），
    # 1080p 帧会全量编码成海量 tokens（8 帧实测 2 分钟）；最长边 560 保持宽高比
    # 只缩不放大，8 帧 ≈ 200 万像素，嵌入耗时降到秒级且不影响时序语义。
    scale = "scale='min(560,iw)':-2"
    cmd = ["ffmpeg", "-y"]
    paths: list[str] = []
    for i in range(n):
        t = (i + 0.5) * dur / n  # 片段中点，避免首尾边界帧
        p = os.path.join(tmpdir, f"frame_{i + 1:03d}.jpg")
        paths.append(p)
        cmd += ["-ss", f"{t:.3f}", "-i", video, "-frames:v", "1",
                "-vf", scale, "-q:v", "2", p]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if r.returncode != 0:
        raise HTTPException(500, f"ffmpeg extract frames failed: {r.stderr[-300:]}")
    frames = [p for p in paths if os.path.exists(p)]
    if not frames:
        raise HTTPException(500, "no frames extracted")
    return frames


@app.get("/health")
def health():
    return {
        "ok": True,
        "model": os.path.basename(MODEL_DIR),
        "dim": DIM,
        "loaded": _embedder is not None,
        "modalities": ["text", "image", "video"],
    }


@app.post("/embed", response_model=VectorsResponse)
def embed(req: EmbedRequest):
    embedder = get_embedder()
    vecs = embedder.process([{"text": t} for t in req.texts])
    vectors = _to_list(vecs)
    return VectorsResponse(vectors=vectors, dim=len(vectors[0]) if vectors else DIM)


@app.post("/embed-image", response_model=VectorResponse)
def embed_image(req: EmbedImageRequest):
    if not os.path.exists(req.image):
        raise HTTPException(404, f"image not found: {req.image}")
    embedder = get_embedder()
    vec = embedder.process([{"image": req.image}])
    vector = _to_list(vec)[0]
    return VectorResponse(vector=vector, dim=len(vector))


@app.post("/embed-video", response_model=VectorResponse)
def embed_video(req: EmbedVideoRequest):
    if not os.path.exists(req.video):
        raise HTTPException(404, f"video not found: {req.video}")
    embedder = get_embedder()
    frames = _extract_frames(req.video, max(2, req.frame_sample_num))
    vec = embedder.process([{"video": frames}])
    vector = _to_list(vec)[0]
    return VectorResponse(vector=vector, dim=len(vector))


@app.post("/embed-segments", response_model=VectorsResponse)
def embed_segments(req: SegmentsRequest):
    """片段级多模态嵌入：返回与 items 等长的向量数组（每片段一个向量）"""
    embedder = get_embedder()
    inputs = []
    for item in req.items:
        if item.get("video") and os.path.exists(item["video"]):
            inputs.append({"video": _extract_frames(item["video"], max(2, item.get("frames", 8)))})
        elif item.get("image") and os.path.exists(item["image"]):
            inputs.append({"image": item["image"]})
        elif item.get("text"):
            inputs.append({"text": item["text"]})
        else:
            raise HTTPException(400, f"segment needs text/image/video: {item}")
    if not inputs:
        return VectorsResponse(vectors=[], dim=DIM)
    vecs = embedder.process(inputs)
    vectors = _to_list(vecs)
    return VectorsResponse(vectors=vectors, dim=len(vectors[0]) if vectors else DIM)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="127.0.0.1", port=8765)
