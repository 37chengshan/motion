---
name: motion-design
description: 项目内编排技能：把分镜（video-spec/storyboard）的每个镜头映射到可执行动效规则（HyperFrames data-* 时序 / GSAP / Three.js / Lottie），并判定每个镜头应使用哪种运动，不做统一入场动画。只编排已锁定原子技能（motion-design-skills、web-animation-skills、hyperframes-animation、hyperframes-keyframes），不复制其正典表格。
---

# Motion Design — 镜头到动效的映射

每个镜头必须显式选择运动类型，禁止整套照搬统一入场动画。

## 流程

1. 读 `runs/<date>/<run>/timeline/` 与 `video-spec.md`/`storyboard.md`，列出每个镜头。
2. 按镜头语义从以下类型选择并记录到 `motion-manifest.json`：
   - `reveal` — 信息进入（标题/要点），使用 GSAP 时序或 hyperframes-animation reveal 规则
   - `data-motion` — 数字/图表动画，使用 beat-sync-editing 与数据卡组件
   - `camera` — 缩放/平移/翻转/遮罩，使用 hyperframes-keyframes（punch-in/out、reframe）
   - `carousel` — 多卡片轮播/激活
   - `none` — 静态信息、仅切换
3. 每个镜头输出：
   ```json
   {
     "shot_id": "s03",
     "motion_type": "reveal",
     "runtime": "gsap|hyperframes|three|lottie",
     "rule_ref": "hyperframes-animation: reveal-headline",
     "duration_ms": 4000,
     "constraints": ["root data-start=0", "单一 paused timeline", "允许属性白名单"]
   }
   ```
4. 约束强制（来自 hyperframes-core determinism）：无 `repeat:-1`、无运行时时钟、无未种子随机、动画只作用允许属性、`data-duration` 与 timeline 一致。

## 输出与校验

- 输出：`runs/<date>/<run>/timeline/motion-manifest.json`
- 校验：`npx hyperframes check --strict` + midpoint/end snapshot 人工比对 motion-manifest；任一镜头无 mapping → fail。

## 调用约束

- 只调用 `skills.lock.json` 锁定的原子技能；不复制其规则表正文。