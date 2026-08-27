# TTS 配音流程（GPT-SoVITS）

## 方案选型

| 方案 | 显存 | 特点 |
|------|------|------|
| **GPT-SoVITS（首选）** | 6G+ | 5 秒克隆，中文最佳 |
| Fish Speech | 4G+ | 多语言优秀 |
| ChatTTS / Kokoro | CPU 可跑 | 低配备选 |

## GPT-SoVITS 接入步骤

1. **部署**：
   ```bash
   git clone https://github.com/RVC-Boss/GPT-SoVITS.git
   cd GPT-SoVITS
   pip install -r requirements.txt
   python api_v2.py  # 启动 API 服务（默认 9880 端口）
   ```

2. **训练音色**：录制 20-60 秒自己的声音 → WebUI 中训练（参考音频 + 标注文本）

3. **每日配音**：
   ```bash
   # 将今日文案发送到 API
   curl -X POST http://localhost:9880/tts \
     -H "Content-Type: application/json" \
     -d '{"text": "今日AI速报……", "ref_audio_path": "voice/ref.wav", "text_lang": "zh"}' \
     --output out/narration.mp3
   ```

4. **嵌入 Remotion**：`<Audio src={staticFile("narration.mp3")} />`

## 自动化管线（规划）

```
文案（today.json blocks）
  → 合并旁白文本
  → GPT-SoVITS API 合成
  → out/narration.mp3
  → Remotion <Audio> 嵌入
  → ASR（whisper）生成字幕时间轴
  → SRT 输出（B站外挂 / 抖音烧录用）
```

## 注意事项

- 中文文本建议预先分句（每句 < 50 字），避免韵律崩坏
- 长文本分段合成后用 FFmpeg concat
- 显存不足时改用 Fish Speech 或 API 服务商
