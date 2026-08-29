---
name: hyperframes-media
description: 项目内编排技能：负责素材、音频、字幕、时间轴和渲染交接。编排已锁定的原子技能（media-use、hyperframes-audio、hyperframes-cli、hyperframes-core），管理 reads/<run>/ 内的资产清单、音轨一致性、渲染门与交接包。不复制其正典表格。
---

# Hyperframes Media — 素材/音频/字幕/渲染交接

## 素材清单（media-manifest.json）

每个素材条目必须含：`prompt`、`model`、`provider`、`width`、`height`、`sha256`、`license_source`、`generated_at`。外部导入 PNG/MP4 必须重新计算 SHA-256 并记录来源；缺许可/来源 → 该素材标记 `unusable` 且不得进包。

## 音频（Windows producer 权威输入）

- 默认只接受配置的 CosyVoice endpoint 产物；启用替代 provider（如 edge-tts）必须显式配置，并在 run manifest 记录 provider/voice/参数/每段 WAV hash。
- Mac 只消费最终 WAV/SRT/视频；任何人不得在 Mac 上运行 TTS、FFmpeg、模型。

## 字幕与时间轴

- 字幕 `subtitle.srt` 由 `gen-srt.ts` 从同一 timeline 生成；block/narration 数量必须一致。
- timeline hash 与 config hash 必须写入 review 报告与包 manifest。

## 渲染与交接

1. HyperFrames：`npx hyperframes check --strict` → snapshot（中点/末点）→ `render --quality high` → `ffprobe` 校验时长/分辨率/音视频流。
2. Remotion（周更）：bundle 一次 → 每 job 独立 `inputProps` → `renders/short.mp4|long.mp4`。
3. 渲染批准：draft render 且整片 review 通过后，才可以 high quality 最终渲染；最终渲染产物再 review 一次才进交接包。
4. 打包：`create-package.ts` 仅接受全部门通过；产物收敛到 `runs/<date>/<run>/package/`，每文件流式 SHA-256，≤2 GiB。

## 校验

- `batch-result.json` 每项含 check/render exit code、MP4 路径、字节数、duration、SHA-256、错误日志路径。
- 任一 job 失败不吞错：整体非零，保留其他成功 job。

## 调用约束

- 只调用 `skills.lock.json` 锁定的原子技能；不复制其正典表格正文。