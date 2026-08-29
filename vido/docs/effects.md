# 动画·运镜·AI生图清单（文档与代码割裂已标注）

> 来源：Remotion 官方 12 包 + video-shotcraft + rough-notation + lottie-web + GSAP/mo.js + 社区精选  
> 对标：Milvus 天花板 691s（307帧实测，见 `.ccg/tasks/milvus-video-ai-analysis/supplement-visual-motion.md`）— 高级感 = AI生图 + 默认运镜  
> **动效是可选，运镜是必选** — 该视频每张图解都有运镜，无静态PPT

## 零、默认运镜（必选，每张图解都有）— 配方 + 参数示例

> 状态：⏳ 规划（文档已定，代码待 M 任务落地）；已可用转场 `Wipe/Fade` ✅

| 运镜 | 效果 | 配方参数 | 配置字段 | 状态 |
|---|---|---|---|---|
| Ken Burns 缓慢推拉 | 95%→100% 12s 呼吸感 | `scale: 0.95→1.0, duration: 12s, easing: easeInOut, origin: center` | `camera: "kenburns"` (默认) | ⏳ 规划 → `KenBurns.tsx` + `@remotion/motion-blur` |
| Pan 平移 | 随箭头 2-3% 横移 | `translateX: -3%→0, duration: 1.2s, easing: easeOut` | `camera: "pan-right"` / `"pan-left"` | ⏳ 规划 |
| FlowArrow 流动 | 绿色虚线循环 | `stroke-dasharray: 8 8, dashoffset: 16→0, loop, color: #34D399` | 自动（有 `arrows` 即启用） | ⏳ 规划 → `FlowArrow.tsx` (SVG) |
| Stagger 逐项揭示 | 卡片弹簧依次弹出 | `delay: index*80ms, mass: 0.8, damping: 12, stiffness: 120` | `reveal: "stagger"` | ⏳ 规划 → `StaggerCards.tsx`（`ListBlock` 已有雏形 ✅） |
| Pulse 高亮 | 当前卡片发光+微放大 | `scale: 1.02, box-shadow: 0 0 0 1px #22D3EE + 0 8px 24px rgba(34,211,238,0.2), duration: 0.6s` | 自动（当前 `index`） | ⏳ 规划 → `PulseHighlight.tsx` |
| Wipe/Fade 转场 | 章节切换 0.4s | `duration: 0.4s, easing: easeInOut` | `transition: "wipe"` | ✅ 可用（`@remotion/transitions` 已依赖） |
| DollyZoom 希区柯克 | 背景推远主体放大 | `scale: 1.3→1, perspective: 1000px` | `camera: "dolly"` | 📋 清单，仅文档 |
| BeatZoom 节拍缩放 | 卡点缩放 | `scale: 0.98→1.05, sync: beat` | `effect: "beat"` | 📋 清单，仅文档 |
| CameraShake 抖动 | 镜头微震 | `translate: ±2px, duration: 0.08s, loop: 3` | `camera: "shake"` | 📋 清单，仅文档 |

```json
// BlockRenderer 将读取 camera/reveal/diagram，307帧视频同款
{ "type": "diagram", "content": "Segment两态", "camera": "kenburns", "reveal": "stagger", "diagram": "SegmentStates", "arrows": true }
```

## 零-B、AI生图管线（三轨，见 VIDO.md §五）

```
LLM提示词批量 → SDXL/即梦/可灵（图标+背景，扁平矢量，visual_prompt）→ 程序化布局（Mermaid/Manim/Remotion Shapes，diagram_spec 保文字清晰）→ 叠加合成
```

- 文生图只做图标/背景，不做文字（避乱码）；文字层用 Remotion/SVG 渲染，可检索
- 字段映射：`timeline.json: { visual_prompt, diagram_spec, camera, reveal }`
- 领域图库待新增：`src/components/diagrams/milvus/*`（ScalarIndexTree / VectorVsScalar / SegmentStates / PartitionScan）
- 模型选型见下文 QC 推荐（Doubao-Seedream 4.0 / Kling V2.1 / Kolors）

## 一、已实现组件（`src/components/effects/` 真实存在 ✅）— 8 项

> 以下为 `BlockRenderer.tsx` 真正 `import` 并可用的组件，其余 55 项中仅文档清单

| 组件 | 效果 | 文件 | 状态 |
|------|------|------|------|
| TypewriterEffect | #1 逐字打字机 + 闪烁光标 | `TypewriterEffect.tsx` | ✅ 已实现 |
| StaggerText | #2 弹簧物理逐字交错出现 | `StaggerText.tsx` | ✅ 已实现 |
| BlurText | #8 模糊→清晰逐词揭示 | `BlurText.tsx` | ✅ 已实现 |
| TerminalTypewriter | #29 macOS 终端 + 命令逐行打字 | `TerminalTypewriter.tsx` | ✅ 已实现 |
| CodeBlock | 代码块深色主题 + 打字机 | `CodeBlock.tsx` | ✅ 已实现 |
| ListBlock | 列表逐项弹簧进入（stagger雏形） | `ListBlock.tsx` | ✅ 已实现 |
| HandDrawing | 手绘动画（evolvePath 真实绘制顺序） | `HandDrawing.tsx` | ✅ 已实现 |
| CharacterProgressBar | 角色进度条（小动物奔跑） | `CharacterProgressBar.tsx` | ✅ 已实现 |
| BgmAudio | 音频容器 | `BgmAudio.tsx` | ✅ 已实现 |
| ComparisonCard | 对比卡 | `ComparisonCard.tsx` | ✅ 已实现 |
| StatCounter | 数字计数 | `StatCounter.tsx` | ✅ 已实现 |
| ProgressSteps | 步骤进度 | `ProgressSteps.tsx` | ✅ 已实现 |

> ⚠️ `StatCounter/ComparisonCard/ProgressSteps` 存在但未在本文档旧版表格中列出，已补齐

## 二、文字动效（规划多于实现）

| # | 效果 | 状态 |
|---|------|------|
| 1. TypewriterEffect 逐字打字机 | ✅ 已实现 |
| 2. StaggerText 弹簧交错 | ✅ 已实现 |
| 7. BlurText 模糊揭示 | ✅ 已实现 |
| 8. ScalePop 弹跳缩放 | ⏳ 规划 |
| 3. WordFlip 翻词 | ⏳ 规划 |
| 4. ScrambleText 乱码解码 | ⏳ 规划 |
| 5. WaveText 波浪浮动 | ⏳ 规划 |
| 6. GradientText 渐变流光 | ⏳ 规划 |
| 9. Rotate3DText 3D 翻转文字 | ⏳ 规划 |
| 10. RoughHighlight 手绘标注 | 📦 依赖已装 `rough-notation`，未封装 |

## 三、创意转场（`@remotion/transitions` ✅ 可用）

| # | 效果 | 状态 |
|---|------|------|
| 11. Fade 淡入淡出 | ✅ 可用 |
| 12. Slide 滑动 | ✅ 可用 |
| 13. Wipe 擦除 | ✅ 可用 |
| 14. Flip 翻页 | ✅ 可用 |
| 15. ClockWipe 时钟擦除 | ✅ 可用 |
| 16. Iris 圆形扩散 | ✅ 可用 |

## 四、3D / 粒子（`@remotion/three` 📦 依赖已装，按需引入）

17. ParticleRain 18. StarField 19. FloatCards 20. SpinningLogo 21. ConfettiBurst 22. GridWave 23. Text3D — 均为 📦 依赖可用，未在 BlockRenderer 中封装

## 五、数据图表（部分已实现）

| # | 效果 | 状态 |
|---|------|------|
| 24. AnimatedCounter 数字滚动 | ✅ `StatCounter` |
| 26. ProgressRing 进度环 | ⏳ 规划 |
| 25. BarChartRace 条形竞赛 | ⏳ 规划 |
| 27. LineChartDraw 折线手绘 | ⏳ 规划（配合 HandDrawing） |
| 28. PieChartReveal 饼图揭示 | ⏳ 规划 |

## 六、终端模拟器

| # | 效果 | 状态 |
|---|------|------|
| 29. TerminalTypewriter | ✅ 已实现 |
| 30. TerminalMatrix 数字雨 | ⏳ 规划 |
| 31. TerminalBoot 启动日志 | ⏳ 规划 |

## 七、经典视频效果（`@remotion/*` 官方包 📦 依赖已装）

| # | 效果 | 状态 |
|---|------|------|
| 32. LightLeaks 镜头漏光 | 📦 依赖可用 |
| 33. MotionBlur 动态模糊 | 📦 依赖可用（配合 KenBurns） |
| 35. KenBurns 缓慢推拉 | ⏳ 规划（已依赖 motion-blur） |
| 50. ShapesAnimation | 📦 依赖可用 |
| 34/36-49. FilmGrain/Glitch/Chromatic/VHS/CRT 等 | 📋 清单，仅文档 |

## 八、节奏运镜（`video-shotcraft` 配方卡 — 📋 清单）

51. BeatZoom 52. SpeedRamp 53. WhipPan 54. DollyZoom 55. MatchCut — 均为 📋 文档清单，未实现

## 用法

在 `src/data/today.json` 的 block 上：

```json
// 文字类（已实现）
{ "type": "text", "content": "重点内容", "effect": "stagger" }

// 图解类（规划，M任务后可用）
{ "type": "diagram", "diagram": "SegmentStates", "camera": "kenburns", "reveal": "stagger" }
```

## 扩展指引

- Lottie 动画：`@remotion/lottie` 直接嵌入 AE 导出 JSON
- Rive 动画：`@remotion/rive` 嵌入 .riv 文件
- 手绘标注：`rough-notation` 7 种类型（underline/box/circle/highlight/strike/boxed-highlight/bracket）
- 完整效果索引：`PLAN.md` 第四节
- 307帧运镜证据：`.ccg/tasks/milvus-video-ai-analysis/supplement-visual-motion.md`

> **差距说明**：本文档旧版列 55 项“清单”，实际 `BlockRenderer.tsx` 仅 8 项可用，已在本版按 ✅/📦/⏳/📋 四档标注，避免文档与代码割裂；运镜与AI生图为本次对标 Milvus 新增，非历史债务
