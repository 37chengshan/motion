# 02 · 方向：GitHub 热点 / 个人项目介绍

> 覆盖：GitHub 热点项目（github-daily）+ 自有项目（EduEvidence、archify 等）。每周产出 B 站视频介绍 GitHub 热点或自有项目。

## 工作流

```bash
# 0) 选题（GitHub 热点走 daily-pipeline 的 github 候选）
node scripts/daily-pipeline.ts --date <今日>          # 含 GitHub 候选（github-daily）

# 1) 写文案（方向 2 文案规则见 doc/04 §GitHub/个人项目）：
#    - 项目定位/架构/模型名单必须来自仓库最新 spec（远程仓库拉取，禁本地缓存、禁凭记忆）
#    - 拉取最新版：curl -x http://127.0.0.1:7890 -L codeload.github.com/<owner>/<repo>/tar.gz（gh clone 常被 schannel 中断）
# 2) 文案人工审查（doc/04 门）→ 锁定副本快照
```

## 自有项目两条子线

### 2a · EduEvidence（手帐风机制动画线）
- 权威语义源：`D:/motion/project/2026-09-01-eduevidence-bilibili/` 对侧仓库的 SKILL.md（6.0）+ `integrations/agent_mcp.py`（真实模型池两级名单、9 步协议、角色=执行适配器）。
- 生产经验库：skill `eduevidence-video-loop`（机制动画 v3 原则、灰框预览、旁白逐字对齐、响度统一、文件锁坑）——**动手前必读**。
- 引擎：Remotion engine（`project/2026-09-01-eduevidence-bilibili/engine`），`render_v1.mjs` 只渲 V1H/V1V（NVENC）。

### 2b · archify（自包含 HTML 架构图 + trace 动画）
- 自包含 HTML：dataflow / sequence / workflow 渲染器 + motion；机制动画参考 archify 的 trace 模型（github.com/tt-a1i/archify）。

### 2c · 其他自有项目
- 按项目建"日期-名称"目录（doc/08 约定），语义从远程仓库最新 spec 核对。

## 排版模板（详见 doc/09 §GitHub/个人项目）

- **手帐风**（EduEvidence 风格）：暖纸 #FDFBF4 + 手绘组件（便签/印章/手绘圈线）+ **机制动画**（系统如何运行：证据流动/智能体接力/判决下落，禁入场/转场特效误用）。
- **dark-tech 深色科技**（中间件/技术架构类，对标 Milvus 天花板）：#0B1220 / #22D3EE / #A78BFA（StyleProvider dark-tech 待补实现）。
- GitHub 项目画面主体：真实仓库页/文档/界面截图（真图铁律 doc/00）+ terminal-typing / glass-code-walk / chart-grow 等卡（79 卡，vtc/src/cards）。
- 禁止 AI 生图冒充真实界面；机制类内容用代码化方案（Remotion/SVG）动画。

## 验收重点（叠加 doc/05 通用审查）

- 产品语义逐字核对（版本号/型号/架构名与最新 spec 一致）。
- "介绍对象=Skill/产品/仓库"用词一致；涉及"用法组合"不写死为固定结构。
- 真图坐标标注机器实测（禁目测）。
