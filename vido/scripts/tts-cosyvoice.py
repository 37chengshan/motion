# -*- coding: utf-8 -*-
"""
TTS 旁白合成脚本 — 双后端：CosyVoice2（首选）→ edge-tts（暂代）

后端选择：
  1. CosyVoice2：阿里 FunAudioLLM，3 秒克隆音色
     - 通过 HTTP API 调用（环境变量 COSYVOICE_API_URL，如 http://localhost:9880）
     - POST {"text": "...", "ref_audio": "可选参考音频路径"} → wav 二进制
     - 用户本地部署好后设置环境变量即可无缝切换
  2. edge-tts（已安装 7.2.8）：微软 Edge 语音，免费暂代
     - 音色：zh-CN-YunxiNeural（男，默认）/ zh-CN-XiaoxiaoNeural（女）
     - 环境变量 TTS_VOICE 可换

用法：
  python scripts/tts-cosyvoice.py                    # 读 src/data/today.json
  python scripts/tts-cosyvoice.py --config <path>    # 指定配置
  python scripts/tts-cosyvoice.py --voice zh-CN-XiaoxiaoNeural

输入：today.json 的 blocks[].narration（无 narration 的 block 跳过）
输出：out/voiceover/{blockIndex}.wav（44.1kHz）
"""
import argparse
import asyncio
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = ROOT / "src" / "data" / "today.json"
DEFAULT_OUT = ROOT / "out" / "voiceover"
COSYVOICE_API_URL = os.environ.get("COSYVOICE_API_URL", "").rstrip("/")
TTS_VOICE = os.environ.get("TTS_VOICE", "zh-CN-YunxiNeural")


def synth_cosyvoice(text: str, ref_audio: str | None) -> bytes | None:
    """调用 CosyVoice2 HTTP API，返回 wav 二进制；不可用返回 None"""
    if not COSYVOICE_API_URL:
        return None
    payload = json.dumps({"text": text, **({"ref_audio": ref_audio} if ref_audio else {})}).encode()
    req = urllib.request.Request(
        f"{COSYVOICE_API_URL}/tts",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            if resp.status == 200:
                return resp.read()
    except Exception as e:
        print(f"[tts] CosyVoice2 调用失败，回退 edge-tts: {e}")
    return None


async def synth_edge_tts(text: str, out_mp3: Path) -> bool:
    """edge-tts 合成到 mp3（带重试：偶发服务端拒绝），返回是否成功"""
    import time

    try:
        import edge_tts
    except Exception as e:
        print(f"[tts] edge-tts 导入失败: {e}")
        return False

    # 偶发 "No audio was received" 是服务端间歇拒绝，重试可解
    for attempt in range(3):
        try:
            communicate = edge_tts.Communicate(text, TTS_VOICE, rate="+8%")
            await communicate.save(str(out_mp3))
            if out_mp3.exists() and out_mp3.stat().st_size > 0:
                return True
        except Exception as e:
            if attempt == 2:
                print(f"[tts] edge-tts 重试 3 次仍失败: {e}")
                return False
        time.sleep(2)
    return False


def mp3_to_wav(mp3: Path, wav: Path) -> bool:
    """ffmpeg 转 44.1kHz wav"""
    try:
        r = subprocess.run(
            ["ffmpeg", "-y", "-i", str(mp3), "-ar", "44100", "-ac", "1", str(wav)],
            capture_output=True,
            timeout=60,
        )
        return r.returncode == 0
    except Exception as e:
        print(f"[tts] ffmpeg 转换失败: {e}")
        return False


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument("--ref-audio", default=None, help="CosyVoice2 克隆参考音频路径")
    args = parser.parse_args()

    config_path = Path(args.config)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    config = json.loads(config_path.read_text(encoding="utf-8-sig"))
    blocks = config.get("blocks", [])
    narrated = [i for i, b in enumerate(blocks) if (b.get("narration") or "").strip()]

    if not narrated:
        print("[tts] today.json 无 narration 字段，无可合成旁白（正常：无旁白视频）")
        return

    backend = f"CosyVoice2 ({COSYVOICE_API_URL})" if COSYVOICE_API_URL else f"edge-tts ({TTS_VOICE})"
    print(f"[tts] 后端：{backend}")
    print(f"[tts] 待合成 {len(narrated)} 段旁白 → {out_dir}")

    ok = 0
    for idx in narrated:
        text = blocks[idx]["narration"].strip()
        wav_path = out_dir / f"{idx}.wav"
        mp3_path = out_dir / f"{idx}.mp3"

        # 1) CosyVoice2 优先
        data = synth_cosyvoice(text, args.ref_audio)
        if data:
            wav_path.write_bytes(data)
            ok += 1
            print(f"[tts] {idx}.wav (CosyVoice2, {len(data)} bytes)")
            continue

        # 2) edge-tts 暂代
        if await synth_edge_tts(text, mp3_path):
            if mp3_to_wav(mp3_path, wav_path):
                ok += 1
                print(f"[tts] {idx}.wav (edge-tts)")
                mp3_path.unlink(missing_ok=True)
                continue

        print(f"[tts] 第 {idx} 段合成失败")

    print(f"[tts] 完成：{ok}/{len(narrated)} 段 → {out_dir}/")
    print("[tts] 下一步：node scripts/prepare-audio.ts（生成 timeline.json）")
    sys.exit(0 if ok == len(narrated) else 1)


if __name__ == "__main__":
    asyncio.run(main())
