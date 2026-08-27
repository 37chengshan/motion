#!/bin/bash
# 用法: tts.sh <文本.txt> <输出.mp3> [声音] [语速]
# 产出: mp3 + 同名词级 VTT（字幕用真实时间戳，配合 srt-builder.py）
V="${3:-zh-CN-YunxiNeural}"; R="${4:-+10%}"
if [ -n "$TTS_BIN" ] && [ -x "$TTS_BIN" ]; then
  TTS="$TTS_BIN"
elif which edge-tts >/dev/null 2>&1; then
  TTS="$(which edge-tts)"
elif [ -f "/Users/cc/edu/video-bilibili/.venv/bin/edge-tts" ]; then
  TTS="/Users/cc/edu/video-bilibili/.venv/bin/edge-tts"
else
  TTS="edge-tts"
fi
"$TTS" --voice "$V" --rate="$R" --file "$1" --write-media "$2" --write-subtitles "${2%.*}.vtt"
ffprobe -v error -show_entries format=duration -of csv=p=0 "$2"
