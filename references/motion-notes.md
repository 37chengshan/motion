# 动画配方笔记 · Remotion 实现模式

> 手帐风视频的道具动画配方。所有模式已在本仓库验证可行（Remotion 4.0.390）。

## 核心原则
- 一切动画 = `useCurrentFrame()` 的纯函数（Remotion 逐帧渲染，天然确定性）
- 入场用 `spring({frame: frame - delay, fps, config:{damping:12}})`（过冲拍上感）
- 匀速/缓动用 `interpolate(frame, [f0,f1], [v0,v1], {extrapolateLeft/Right: "clamp"})`
- **手绘逐笔 = SVG strokeDasharray/strokeDashoffset**：设 `strokeDasharray={len}`，`strokeDashoffset={len*(1-p)}`，p 为 0→1 的 interpolate。这是手帐风的灵魂（hyperframes 禁此属性，Remotion 原生支持）

## 配方清单

| 效果 | 实现 |
|---|---|
| **打字机**（逐字符+光标） | 文本 `Array.from(text)` 逐字 `<span style={{opacity: frame - start > i ? 1 : 0}}>`；光标块 `opacity: Math.floor(frame/8)%2`；每字 2-3 帧 |
| **手绘圈** | `<ellipse strokeDasharray={周长} strokeDashoffset={周长*(1-p)}>`，p 用 interpolate 1s；圈两圈可叠两个椭圆错开 |
| **手绘勾/叉** | 两段 path 各自 dashoffset 依次画（第一段 p∈[0,0.5]，第二段 p∈[0.5,1]） |
| **荧光笔划重点** | 半透明色块 `scaleX: p`（transformOrigin left）+ 轻微 rotate，叠在文字下层 |
| **便利贴拍上** | `spring` scale 0.6→1（damping 10-12）+ rotate 从 ±8°→±1.5°；图钉/胶带在 spring 完成后 1 帧出现 |
| **便利贴撕走** | rotate 增大 + x/y 出画（interpolate 0.4s，ease 无） |
| **印章盖下** | scale 1.9→1（0.15 帧/极快）+ 落地震屏（容器 x ±7 抖 4 帧）+ 透明度 0.85 保持 |
| **尺子→刻度轴** | 尺子 SVG x 从 -500→工作位（spring），到位后尺身 opacity→0.12 同时同位置刻度组 opacity→1 并 scaleX 0.96→1（两态交叠 8 帧完成"变形"） |
| **纸团/纸页飞入** | rotate 720°→0 + x 从画外→目标 + spring |
| **翻页擦除转场** | 全屏米白 div x: -1920→0（前半）→1920（后半），中点切换场景内容；或 scaleX 0→1（origin left）→0（origin right） |
| **横线逐行画出** | 每行 div 高 3px `scaleX: interpolate(frame - rowDelay, [0,12],[0,1])`（origin left），文字延迟 8 帧淡入 |
| **猫走路** | x = interpolate(frame,[0,total],[60,1860])；y = sin(frame/3)*6（颠簸）；尾巴 rotate = sin(frame/4)*14°；耳朵 scale 抖 frame%24<3 |
| **铅笔互敲（交叉审核）** | 两支铅笔 rotate ±12° 交替（sin 相位相反）+ 敲击帧冒火花（小星形 opacity 闪 2 帧） |
| **60fps 网页录屏** | CDP screencast 素材 → ffmpeg `-vf minterpolate=fps=60:mi_mode=blend` 补帧 → `<OffthreadVideo>` 嵌入 |

## 踩坑记录
- Remotion 渲染需项目根有 tsconfig.json（官方模板可抄）
- `<Audio>` 挂载按秒换算帧：`startFrom`/`sequence from={秒*fps}`
- 长视频渲染用 `--concurrency` 默认 CPU 半数；Chrome Headless Shell 自动下载
- edge-tts VTT 的 cue 本身是整句级；要短语字幕需 `--words-in-cue 6` 重生成，再用 tools/srt-builder.py 按真实边界合并
