---
name: vido-open-source
description: 制作 GitHub 开源项目科普介绍视频（Remotion 引擎），按项目类型（CLI/Web/AI 模型/数据）生成专属精细动画而非幻灯片。当用户要"介绍这个开源项目/做个项目科普视频/安利这个 GitHub 项目"、给出 repo 链接或提到 project-spotlight 时使用。流程：GitHub API 深抓真实数据 → 科普叙事组装 → CosyVoice2 旁白 → Remotion 双格式渲染 → proof frames 审查。
---

# Vido 开源项目科普（Remotion 引擎）

科普叙事结构：开场钩子（项目名+痛点+star 计数滚动）→ 问题对比（没有它 vs 有它）→ 核心特性 → 架构手绘 → 真实上手（README 实测命令）→ 数据收尾（GitHub 数据卡+链接）。双格式：竖屏 1080×1920 + 横屏 1920×1080。

共享底座见 [docs/workflow.md](../../../docs/workflow.md)——先读它。

## 完整流程

### 1. 深抓项目真实数据（必须，禁止凭记忆写）

```bash
# 仓库元数据（stars/forks/语言/创建时间）
curl -s -H "User-Agent: vido-research" https://api.github.com/repos/<owner>/<repo>
# README 原文
curl -s -H "User-Agent: vido-research" -H "Accept: application/vnd.github.raw" \
  https://api.github.com/repos/<owner>/<repo>/readme
```

要提取：star/fork 数（用 API 实时数，不用缓存的）、语言、License、创建日期、
Quick Start 安装命令（真实命令原样照搬）、核心特性 3 条、架构要点。
README 抓不全时补 `curl -s "https://r.jina.ai/<repo-url>"`。

### 2. 选题确认

用户给了项目链接则直接进入；用户说"找个项目做视频"时：读 research/today/scored.json 的 github-trending 条目，
用 AskUserQuestion 展示 Top 3（含 star 数+一句话介绍）让用户选。

### 3. 生成 today.json（科普叙事结构，文字是信息主体）

每个 block 必须含 `summary`（详细文字介绍），关键场景加 `points`/`stats` 模块。
禁止只有标题/数字没有正文的页面——观众静音也能看懂：

```json
{
  "type": "open-source", "engine": "remotion", "template": "project-spotlight",
  "style": "minimal-tech",
  "title": "<项目名>", "subtitle": "<一句话定位>",
  "blocks": [
    {"type": "title", "content": "<项目名>", "highlight": "<N> stars", "summary": "<2-4 句项目介绍>", "section": "features", "narration": "…"},
    {"type": "list", "content": "它解决什么问题", "summary": "<痛点分析>", "items": ["没有它：…", "有它：…"], "section": "problem", "narration": "…"},
    {"type": "list", "content": "核心特性", "summary": "<设计哲学>", "items": ["…×4-5 条"], "section": "features", "narration": "…"},
    {"type": "hand-drawing", "content": "架构：…", "summary": "<架构说明>", "svgPath": "…", "section": "architecture", "narration": "…"},
    {"type": "terminal", "content": "$ <真实命令>…", "summary": "<上手说明>", "section": "hands-on", "narration": "…"},
    {"type": "text", "content": "GitHub 数据", "summary": "<数据解读>", "stats": [{"label":"Stars","value":"2.7k"},…], "points": ["…×3"], "highlight": "<N> stars", "source": "…", "url": "…", "section": "outro", "narration": "…"}
  ]
}
```

信息密度要求：summary ≥80 字；特性页 items ≥4 条；数据页 stats ≥4 个 + points ≥3 条。

### 4. 项目类型 → 动画分支选择

ProjectSpotlight 模板（src/components/templates/ProjectSpotlight.tsx）按 block type 自动路由页面：

| 项目类型 | 推荐页面组合 |
|---|---|
| CLI/终端工具 | terminal 页为主（真实命令逐行打字）+ problem 对比 |
| Web/前端 | features 列表 + terminal 安装命令 |
| AI 模型/库 | hand-drawing 架构页 + problem 对比 |
| 数据/性能 | chart 步骤页 + highlight 数字卡 |

需要新页面类型时：在 ProjectSpotlight.tsx 加 SceneForBlock case + 新页面组件（参考现有 HookPage/ProblemPage 写法，用 useStyle 主题）。

### 5. 旁白 + 时间轴 + 渲染

```bash
npm run tts          # CosyVoice2 优先，edge-tts 暂代
npm run timeline     # out/timeline.json（Remotion 自动读它定时长+挂 Audio）
npm run srt
npx tsc --noEmit     # 必须 0 错误
npm run render:all   # 双格式 → out/video_short.mp4 + video_long.mp4
```

Remotion 侧音画同步自动生效：Root.tsx 读 out/timeline.json 定 totalFrames，
VidoShort/VidoLong 按 targetFrames 播 Sequence 并挂对应旁白 Audio。

### 6. 审查与交付

- 渲染后按 timeline proofTimestamps 抽帧 + contact sheet 审查（docs/workflow.md 第七节）
- 重点检查：star 数字与 GitHub API 一致、终端命令与 README 一致、文字无溢出
- 不合格：改 today.json 对应 block（时间轴不动）→ 重跑 tts/timeline（如 narration 变了）→ render:all
- 交付 out/video_short.mp4（竖屏）+ video_long.mp4（横屏）+ subtitle.srt

## 常见问题

- 切换选题：直接覆盖 src/data/today.json（单活跃项目模式）；重要配置先备份为 today.<name>.json
- 预览不渲染：npm start 开 Studio（端口 3123）看 VidoShort/VidoLong
- 新效果组件：src/components/effects/ 下建组件（参考 StatCounter.tsx 的 useStyle 用法），BlockRenderer 或 ProjectSpotlight 接入
