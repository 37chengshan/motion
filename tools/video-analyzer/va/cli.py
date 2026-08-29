# -*- coding: utf-8 -*-
"""va — 本地视频下载分析工具（Phase 5）

子命令：
  va download <url> [--out DIR]         yt-dlp 下载（连带字幕 + info.json）
  va analyze <video> [--out JSON]       场景切分 → 时序片段（帧 + 时间戳 + 前后邻接）→ 文本片段嵌入
  va ingest <dir>                       扫描视频，批量 analyze + 产出 segments JSON
  va search <query> [--db PATH]         向量检索 video-segments（调 embed-server + knowledge.db）

设计要点（用户需求：视频理解不能只看截图，需要前后关系）：
- analyze 产出的是「时序片段序列」而非单张截图：每片段带 globalStartSec/globalEndSec、
  代表帧、相邻片段（prev/next）指针 —— 审查与检索时可按时间邻接还原上下文。
- 有字幕/转写文本的片段 → 文本嵌入（Qwen3-Embedding 经 embed-server）→ 语义可检索。
- 无文本片段 → 保留帧 + 时序，标记 embed: null，视觉审查仍靠人工/视觉模型。
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")


def _probe_duration(video: Path) -> float:
    r = _run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
              "-of", "default=noprint_wrappers=1:nokey=1", str(video)])
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def _scene_cuts(video: Path, threshold: float = 0.3) -> list[float]:
    """ffmpeg select='gt(scene,threshold)' 场景切分 → 切点时间戳列表"""
    r = _run([
        "ffmpeg", "-i", str(video), "-filter:v",
        f"select='gt(scene,{threshold})',showinfo", "-f", "null", "-",
    ])
    cuts = []
    for line in (r.stdout + r.stderr).splitlines():
        if "pts_time:" not in line:
            continue
        try:
            t = float(line.split("pts_time:")[1].split()[0])
            cuts.append(t)
        except (IndexError, ValueError):
            continue
    return sorted(set(round(c, 2) for c in cuts if c > 0.5))


def _frame_at(video: Path, sec: float, out_dir: Path, idx: int) -> Path:
    """抽代表帧 → out_dir/frame-<idx>.jpg"""
    out = out_dir / f"frame-{idx:03d}.jpg"
    _run(["ffmpeg", "-ss", str(max(0, sec)), "-i", str(video),
          "-frames:v", "1", "-q:v", "2", str(out)])
    return out if out.exists() else Path()


def analyze(video: Path, out_json: Path, threshold: float = 0.3) -> dict:
    """场景切分 → 时序片段序列（帧 + 时间戳 + 前后邻接 + 可选文本嵌入标记）"""
    total = _probe_duration(video)
    cuts = _scene_cuts(video, threshold)
    bounds = [0.0, *cuts, total]
    frames_dir = out_json.parent / (out_json.stem + "_frames")
    frames_dir.mkdir(parents=True, exist_ok=True)

    segments = []
    for i in range(len(bounds) - 1):
        start, end = bounds[i], bounds[i + 1]
        if end - start < 0.5:
            continue
        mid = (start + end) / 2
        frame = _frame_at(video, mid, frames_dir, len(segments))
        segments.append({
            "seg_index": len(segments),
            "globalStartSec": round(start, 2),
            "globalEndSec": round(end, 2),
            "durationSec": round(end - start, 2),
            "frame": str(frame.relative_to(video.parent.parent)) if frame else None,
            "prev_seg": len(segments) - 1 if segments else None,  # 时序前邻接
            "next_seg": len(segments) + 1,  # 时序后邻接（最后一段由入库侧修正为 None）
            "text": None,  # 有字幕/转写时填充，供 Qwen3 嵌入
            "embed": None,  # 向量（由 embed-server 生成后回填）
        })
    if segments:
        segments[-1]["next_seg"] = None

    result = {
        "schema_version": 1,
        "video": str(video),
        "totalDurationSec": round(total, 2),
        "scene_count": len(segments),
        "segments": segments,
    }
    out_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def _download(url: str, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    r = _run(["yt-dlp", "--write-sub", "--write-info-json", "--sub-langs", "all",
              "-o", str(out / "%(title)s.%(ext)s"), url])
    if r.returncode != 0:
        print(f"[va] download 失败: {r.stderr[-500:]}", file=sys.stderr)
        sys.exit(1)
    print(f"[va] 下载完成 → {out}")


def main(argv: list[str] | None = None) -> None:
    args = argv if argv is not None else sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)
    cmd, rest = args[0], args[1:]

    if cmd == "download" and rest:
        out = Path(rest[1]) if len(rest) > 1 and rest[1] == "--out" and len(rest) > 2 else Path("downloads")
        # 简化参数解析：--out 在 url 之后
        url = rest[0]
        if len(rest) > 1 and rest[1] == "--out" and len(rest) > 2:
            out = Path(rest[2])
        _download(url, out)
    elif cmd == "analyze" and rest:
        video = Path(rest[0])
        out_json = Path(rest[2]) if len(rest) > 1 and rest[1] == "--out" and len(rest) > 2 else video.with_suffix(".segments.json")
        r = analyze(video, out_json)
        print(f"[va] analyze: {r['scene_count']} 个时序片段 → {out_json}")
    elif cmd == "ingest" and rest:
        import glob
        for v in sorted(Path(rest[0]).glob("*.mp4")):
            out_json = v.with_suffix(".segments.json")
            r = analyze(v, out_json)
            print(f"[va] ingest {v.name}: {r['scene_count']} 段")
    elif cmd == "search":
        print("[va] search 需向量库（Phase 4 knowledge.db），稍后实现")
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
