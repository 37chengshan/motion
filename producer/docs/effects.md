# 55 个动画效果清单

> 来源：Remotion 官方 12 包 + video-shotcraft + rough-notation + lottie-web + GSAP/mo.js + 社区精选

## 一、已实现组件（src/components/effects/）

| 组件 | 效果 | 文件 |
|------|------|------|
| TypewriterEffect | #1 逐字打字机 + 闪烁光标 | `TypewriterEffect.tsx` |
| StaggerText | #2 弹簧物理逐字交错出现 | `StaggerText.tsx` |
| BlurText | #8 模糊→清晰逐词揭示 | `BlurText.tsx` |
| TerminalTypewriter | #29 macOS 终端 + 命令逐行打字 | `TerminalTypewriter.tsx` |
| CodeBlock | 代码块深色主题 + 打字机 | `CodeBlock.tsx` |
| ListBlock | 列表逐项弹簧进入 | `ListBlock.tsx` |
| HandDrawing | 手绘动画（evolvePath 真实绘制顺序） | `HandDrawing.tsx` |
| CharacterProgressBar | 角色进度条（小动物奔跑） | `CharacterProgressBar.tsx` |

## 二、文字动效（10）

1. TypewriterEffect 逐字打字机 ✅
2. StaggerText 弹簧交错 ✅
3. WordFlip 翻词
4. ScrambleText 乱码解码（黑客风）
5. WaveText 波浪浮动
6. GradientText 渐变流光
7. BlurText 模糊揭示 ✅
8. ScalePop 弹跳缩放
9. Rotate3DText 3D 翻转文字
10. RoughHighlight rough-notation 手绘标注（圈选/下划线/高亮）

## 三、创意转场（6，@remotion/transitions）

11. Fade 淡入淡出
12. Slide 滑动
13. Wipe 擦除
14. Flip 翻页
15. ClockWipe 时钟擦除
16. Iris 圆形扩散

## 四、3D / 粒子（7，@remotion/three）

17. ParticleRain 粒子雨
18. StarField 星空穿越
19. FloatCards 3D 悬浮卡片
20. SpinningLogo 旋转 Logo
21. ConfettiBurst 五彩纸屑
22. GridWave 网格波浪
23. Text3D 3D 立体文字

## 五、数据图表（5）

24. AnimatedCounter 数字滚动
25. BarChartRace 条形图竞赛
26. ProgressRing 进度环
27. LineChartDraw 折线图手绘生长（配合 HandDrawing）
28. PieChartReveal 饼图揭示

## 六、终端模拟器（3）

29. TerminalTypewriter ✅
30. TerminalMatrix Matrix 数字雨
31. TerminalBoot 系统启动日志滚动

## 七、经典视频效果（20，官方包）

32. LightLeaks 镜头漏光（@remotion/light-leaks）
33. MotionBlur 动态模糊（@remotion/motion-blur）
34. FilmGrain 胶片颗粒（@remotion/noise）
35. KenBurns Ken Burns 缓慢推拉
36. Glitch 故障抖动
37. ChromaticAberration 色差分离
38. VHS 录像带扫描线
39. CRT 显示器弯曲
40. Vignette 暗角
41. Duotone 双色调
42. Scanlines 扫描线
43. NoiseOverlay 噪点叠加
44. LightSweep 光扫过
45. CameraShake 镜头抖动
46. ZoomPunch 缩放冲击
47. RGBSplit RGB 分离
48. FlashFrame 白闪
49. OldFilm 老电影（抖动+颗粒+暗角）
50. ShapesAnimation 形状动画（@remotion/shapes：rect/circle/heart/pie/ellipse）

## 八、节奏运镜（5，video-shotcraft 配方卡）

51. BeatZoom 节拍缩放
52. SpeedRamp 变速（快慢结合）
53. WhipPan 甩镜头转场
54. DollyZoom 希区柯克变焦
55. MatchCut 匹配剪辑

## 用法

在 `src/data/today.json` 的 block 上指定 `"effect"` 字段，BlockRenderer 会分发到对应组件：

```json
{ "type": "text", "content": "重点内容", "effect": "stagger" }
```

## 扩展指引

- Lottie 动画：`@remotion/lottie` 直接嵌入 AE 导出 JSON
- Rive 动画：`@remotion/rive` 嵌入 .riv 文件
- 手绘标注：`rough-notation` 7 种类型（underline/box/circle/highlight/strike/boxed-highlight/bracket）
- 完整效果索引：`PLAN.md` 第四节
