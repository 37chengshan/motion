# /Users/cc/code/motion · 动画制作中枢

所有代码动画（视频/动效）制作的统一工作区。**以后一切动画项目都放这里。**

## 引擎选型决策树

```
要做的是什么？
├─ 带配音的成片视频（B站/口播/MG包装/字幕）
│   └─ ✅ Remotion（engines/remotion）
│        skills: remotion-official（官方12个） + remotion-koubo（口播成片工作流）
├─ 手绘讲解动画（白板风、逐笔绘制、数学可视化）
│   └─ ✅ Motion Canvas（engines/motion-canvas）——手绘感最强
├─ 数学/公式动画（3Blue1Brown 式）
│   └─ Manim（未装，需要时 git clone ManimCommunity/manim）
└─ 网页交互动效（滚动/悬停，非视频）
    └─ GSAP（全局已有 gsap-core/gsap-react 等 skills）
```

## 目录

| 目录 | 内容 |
|---|---|
| `engines/remotion/` | Remotion 模板工程（依赖已装，`npm run studio` 预览 / `npm run render` 出片）。**新视频项目复制此目录开工** |
| `engines/motion-canvas/` | Motion Canvas 源码（浅克隆） |
| `skills/` | 已收集的动画 skills（见 `skills/INDEX.md`） |
| `projects/` | 实际视频项目，一项目一目录 |
| `assets/` | 共享素材：`fonts/ audio/ sfx/ svg/`（手帐元素：猫、便利贴、胶带、印章） |
| `references/` | `bilibili-watchlist.md`（B站教程清单）、`motion-notes.md`（动画配方） |
| `tools/` | `record-page.js`（网页滚动录制）、`srt-builder.py`（VTT→SRT）、`tts.sh`（配音） |

## 工作规范

1. **开新视频**：`cp -r engines/remotion projects/<名>` → 在副本里写场景组件
2. **配音**：`tools/tts.sh <文本文件> <输出mp3>`（edge-tts zh-CN-YunxiNeural +10%，同时产出词级 VTT）
3. **字幕**：`tools/srt-builder.py`（用 VTT 真实时间戳，禁止字符比例内插——会与语音对不上）
4. **网页实拍**：`tools/record-page.js <url> <前缀> [速度]`（CDP screencast，60fps 补帧见 references/motion-notes.md）
5. **渲染**：`npx remotion render <Comp> out/<名>.mp4 --codec h264 --fps 60`
6. 动画写法先查 `skills/remotion-official/skills/remotion-markup/`，踩坑先查 `skills/remotion-koubo/skills/remotion-gotchas-index/`（34 条错题集）

## 当前项目

- `projects/eduevidence-bilibili/` — EduEvidence B站视频（手帐风双版本重制中）
- 旧版成品（hyperframes 渲染）：`/Users/cc/edu/video-bilibili/`（素材来源，已迁移）
