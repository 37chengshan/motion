# references — 引用（不复制正典）

motion-video 是编排型总 skill，不复制各原子 skill 的正典表格，按需引用：

| skill | 位置 | 本 skill 用它做什么 |
|---|---|---|
| video-talkcraft | ~/.workbuddy/skills/video-talkcraft/ | 口播/录屏方向权威：79 动效卡（taxonomy→cards→template）、SHOTBOOK 三面分层、cinematography（七层反PPT/转场/长镜头）、design-language（Apple 范式）、host-footage、broll-sources |
| eduevidence-video-loop | ~/.workbuddy/skills/ + 项目级 | EduEvidence 系列经验库：语义权威源（SKILL.md 6.0 + agent_mcp.py 真实模型池）、机制动画 v3 原则、TTS/字幕/响度/文件锁坑 |
| motion-design | ~/.workbuddy/skills/ + 项目级 | 分镜（video-spec/storyboard）→ 可执行动效规则编排 |
| video-agency-roles | 同上 | 选题→成片七层质量门（选题/事实/开发者视角/视觉/审美/节奏/平台包装）|
| motion-media-handoff | 同上 | 素材/音频/字幕/时间轴/渲染交接门（media-manifest、音轨一致性）|
| hyperframes 系列 | ~/.workbuddy/skills/ | HyperFrames 编排与原子技能（creative/core/animation/audio/registry 等）|
| watch | ~/.workbuddy/skills/ | 看参考视频（yt-dlp + 抽帧 + 转写）|
| diagram-design | ~/.workbuddy/skills/ | 架构图/机制图（若视频内需要静态技术图解）|

**工程参考**（非 skill，实际代码）：
- producer/src/compositions/BlockRenderer.tsx —— 9 类型 block 排版骨架（title/text/list/code/terminal/hand-drawing/image/video/chart）
- producer/src/compositions/styles/StyleProvider.tsx —— 5+1 风格皮肤（minimal-tech/whiteboard/sticky-notes/newspaper/journal，dark-tech TODO）
- eduevidence engine/src/kit/index.tsx —— 手帐风 C token + 手绘组件库
- vtc/src/cards/ —— 79 卡 Remotion 工程落地（video-talkcraft template/cards 的复制）
