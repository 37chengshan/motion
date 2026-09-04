---
name: motion-video
description: "Motion 项目（D:/motion）总视频工作流 skill：覆盖三个方向——每日新闻（ai-news 重点/intl/cn/ent 四流）、GitHub 热点与个人项目介绍、实操视频/录屏介绍。总流程：入口选方向 → 方向工作流 → 文案人工审查（门）→ 初稿视频 → 审查 3 轮（机器闸 + 独立 subagent + agy/Gemini 终审兜底）→ 出片 → Windows 发布（social-auto-upload）。本 SKILL.md 是目录（<150 行），各方向详细工作流、排版模板、审查制度、发布、向量库、目录约定与迭代进化机制见 doc/。编排引用已锁定 skill：video-talkcraft / motion-design / video-agency-roles / motion-media-handoff / eduevidence-video-loop / hyperframes 系列；不复制其正典表格。"
metadata:
  agent_created: true
---

# Motion Video — 视频工作流总入口

> D:/motion 三条视频生产线的总编排。做视频先读本 SKILL，按方向路由到 doc/，动手前先读 `doc/00-总流程.md` 与 `doc/09-排版模板.md`。

## 总流程（每方向都走这条链）

```
入口(选方向) → [方向工作流 doc/01|02|03] → 文案人工审查(doc/04, 门) → 初稿视频生成
→ 审查3轮(doc/05: 机器闸→独立subagent→agy/Gemini终审) → 出片 → 发布(doc/06, Windows)
```

- 文案先行：文案未经人工审查（事实红线/产品语义）不生成初稿。
- 审查 3 轮封顶：机器闸 5 命令全过 → 1 轮独立 subagent 审片（P0/P1 必修）→ agy/Gemini 整片终审；agy 不可用则把审查 prompt 交给用户人工审后再发布。
- 出片即交付评审产物（审查报告/遗留 P2 清单/章节时间点）。
- 发布走 `social-auto-upload`（B站/抖音/小红书/快手/视频号/微博），Windows 本地，不再需要 Mac publisher。

## 三方向路由

| 方向 | 说"我想做…" | 工作流文档 | 排版模板 | 核心引擎 |
|---|---|---|---|---|
| 每日新闻 | 今日 AI/国际/国内/娱乐新闻 | doc/01 | doc/09 §新闻 | producer（daily-research→score→generate-content→media→BlockRenderer）|
| GitHub/个人项目 | 介绍某 GitHub 项目 / EduEvidence / archify | doc/02 | doc/09 §项目 | eduevidence-bilibili engine / vtc |
| 实操录屏 | 实操/录屏/解说/口播教程 | doc/03 | doc/09 §录屏 | video-talkcraft 全流程 + vtc 工程 |

## doc/ 索引（正文在这里，本文件只路由）

| 文档 | 内容 |
|---|---|
| 00-总流程.md | 全链路分步 + 每个阶段的产物契约 + 统一红线（构图预算/字幕/转场） |
| 01-方向-每日新闻.md | 四流工作流 + **不能破坏清单** + 新闻排版模板引用 |
| 02-方向-github与个人项目.md | GitHub 热点 / 自有项目工作流 + 手帐风机制动画模板引用 |
| 03-方向-实操录屏.md | video-talkcraft 全流程落地（字级时间戳+SHOTBOOK+79卡+机器闸）|
| 04-文案人工审查.md | 文案门：事实红线清单 / 产品语义核对 / 数字汉字化 |
| 05-审查3轮.md | 关卡1 机器闸 → 关卡2 独立 subagent（P0/P1/P2）→ 关卡3 agy/Gemini 终审 + 失败兜底 |
| 06-发布.md | social-auto-upload Windows 发布（平台/账号/草稿闸/校验） |
| 07-向量库.md | embed-server（Qwen3-VL 2048 维）离线底座：选题去重 + 片段复用 |
| 08-目录约定.md | 顶层目录约定（project/日期-名称/）+ 硬编码更新清单 |
| 09-排版模板.md | ★每方向排版卡：token 皮肤 × block 规则 × 卡集 × 字幕统一表 × 构图预算 |
| 10-迭代进化.md | autosearch 式自我进化：session/reflection/post-mortem/指标改善才保留 |

## scripts/（本 skill 自带机器闸，复制自 video-talkcraft）

```bash
# 关卡 1 机器闸（在目标 Remotion 工程目录下执行）
python3 scripts/motion_check.py out/vN.mp4                # 静止段 + 并发光栅抖动
python3 scripts/card_lint.py <工程src> <slug,...>          # 动效卡保真（≥0.55）
python3 scripts/beat_lint.py beats.json timestamps.json --shots shots.json  # 词落点 |Δ|≤0.1s
python3 scripts/sfx_check.py --mix out/vN.mp4 audio/full.wav cues.json      # 音效可听
python3 scripts/beat_gap_check.py beats.json shots.json   # 渲染前空台预检
# 渲染提速
node scripts/render_shots.mjs --shots shots.json --all --parallel 4 --concat out/a.mp4 --audio out/m.wav --mux out/vN.mp4
node scripts/render_stills.mjs --times 2.0,7.2,...        # 批量静帧抽样
python3 scripts/contact_sheet.py /tmp/qa_vN /tmp/sheets   # QA 帧拼 3×4 网格
# 字级时间戳（实操录屏方向，CPU）
python3 scripts/timestamps_cpu.py audio/full.wav script.json audio/timestamps.json
python3 scripts/make_timing.py audio/timestamps.json <工程>/src/timing.json
```

## 引用（不复制正典，按需读原子 skill）

- **video-talkcraft**（~/.workbuddy/skills/）：口播/录屏方向的动效卡（79 张）、SHOTBOOK、三段式、字幕铁律的权威。
- **motion-design / video-agency-roles / motion-media-handoff**（项目级 .workbuddy/skills/）：分镜→动效编排、七层质量门、媒资交接。
- **eduevidence-video-loop**：EduEvidence 系列经验库（语义权威源/机制动画/响度统一/文件锁坑）。
- **hyperframes 系列**：HyperFrames 编排与原子技能。

## 迭代进化（摘要，详见 doc/10）

每次做完一个视频 → 写 session 记录 + reflection block → 把 winning/losing 经验回写对应 doc/（附日期）→ 指标（返工次数/缺陷数/审查轮数）改善才保留做法。
