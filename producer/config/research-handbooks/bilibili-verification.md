---
name: bilibili-verification
version: 1
updated_at: 2026-08-29
status: draft
proxy_required: []
blindtest:
  days: 0
  hit_rate: 0
  last_run: ""
---

# B站回验链手册（盲测校验与素材取证）

用途：**回验**——当日报产出后，对照参考视频/参考源验证「我们漏了什么」，
以及为素材取证提供可追溯路径。这是盲测机制（Phase 6）的手动复现入口。

> 本手册是 agent 的回验细节依据，由 SKILL.md 指向。修改需 bump version 并记录。

## 一、回验链总览

```
B站视频（参考源）
   ↓ ① 视频下载（yt-dlp / bilidown）
   ↓ ② 字幕获取（官方字幕 → Whisper 兜底）
   ↓ ③ 文字版提取（评论区「文字版」/ 动态 / 专栏）
   ↓ ④ 条目抽取（标题 + 时间戳）
   ↓ ⑤ 与当日 selection 比对 → 命中/半命中/漏项
   ↓ ⑥ 写入 runs/blindtest/<date>.json
```

## 二、各层信源与工具

### ① 视频下载

| 工具 | 命令 | 说明 |
|---|---|---|
| yt-dlp | `yt-dlp <bili_url> --write-sub --write-info-json` | 首选，连带字幕与 info.json |
| bilidown | 待部署 | 备援适配器（WBI 签名 / playurl fnval=4048 / 扫码登录） |
| res-downloader | 人工丢 `data/incoming/` | 兜底，人工介入 |

### ② 字幕获取

优先级：
1. **官方字幕**：yt-dlp `--write-sub`（B站部分视频有 CC 字幕）
2. **Whisper 兜底**：无字幕时本地语音识别（Phase 5 `va` 工具链）
3. **音频转写**：`ffmpeg` 抽音轨 → Whisper

### ③ 文字版提取（关键补充）

B站 UP 主常在以下位置放「文字版」：

| 位置 | 获取方式 |
|---|---|
| 评论区置顶 | B站 reply API：`https://api.bilibili.com/x/v2/reply?oid=<aid>&type=1` |
| 动态 | UP 主动态页 |
| 专栏文章 | B站专栏（部分 UP 主同步发文字版） |
| 视频简介 | info.json 的 `description` 字段 |

> **why**：文字版是最高性价比的条目来源——UP 主已把视频内容结构化成文字，
> 比逐帧 OCR 或语音转写准确得多。盲测优先提取文字版。

### ④ 条目抽取

从文字版/字幕中抽取：
- 条目标题（每条新闻的简短描述）
- 对应时间戳（若文字版带时间轴）
- 来源标注（UP 主常标注信源）

## 三、降级链

| 环节 | 主方案 | 降级 1 | 降级 2 | 终点 |
|---|---|---|---|---|
| 视频获取 | yt-dlp | bilidown | res-downloader 人工 | 跳过该参考视频 |
| 字幕/文字 | 评论区文字版 | 官方字幕 | Whisper 转写 | 人工观看抽帧 |
| reply API | B站 API | 网页抓取 | — | 跳过文字版，走字幕 |

**硬规则**：任一环节失败不影响其他环节；文字版优先于语音转写（成本与准确率均更优）。

## 四、盲测比对规则

比对当日 `selection.json` 与参考视频条目：

| 判定 | 标准 |
|---|---|
| **命中 hit** | 同一事件，我方已入选 |
| **半命中 half_hit** | 同一事件但角度不同，或我方有但排位靠后/未入选 |
| **漏项 miss** | 参考视频有，我方候选池完全无此事件 |

计算：`hit_rate = hits / reference_items`（半命中按 0.5 计，需记录两种口径）

输出：`runs/blindtest/<date>.json`
```json
{
  "date": "2026-08-30",
  "handbook_versions": { "ai-news": 1, "intl-news": 1 },
  "candidates": [],
  "reference_items": [],
  "hits": 0,
  "half_hits": 0,
  "misses": 0,
  "hit_rate": 0
}
```

## 五、漏项分析（手册修订依据）

盲测的核心价值在于**漏项归因**，而非命中率数字本身：

| 漏项类型 | 归因方向 | 手册修订动作 |
|---|---|---|
| X 官方/员工帖漏 | X 层覆盖不足 | 扩充 `x-watchlist.json` 或提升 X 层权重 |
| 官方博客漏 | 直连层信源缺失 | 补 RSS 端点 |
| 模型平台发布漏 | 平台信源缺失 | 补 HF/AA 等平台源 |
| 热榜事件漏 | 热榜层覆盖不足 | 补热榜端点或调整权重 |
| 时效错过 | 采集窗口问题 | 调整 `--date`/窗口参数 |

每次盲测后按上表归因，bump 对应手册 version 并记录 `blindtest` 字段。

## 六、记录表

| 日期 | 参考视频 | 参考条目 | 命中 | 半命中 | 漏项 | 命中率 | 主要漏项归因 |
|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | 初始版本，未盲测 |

**定稿规则**：连续 3 天 `hit_rate >= 0.80` 且覆盖 ≥2 个不同工作日 → 对应手册 `status: stable`；
定稿后降频每周 1 次回归，连续 2 周跌破 70% 触发手册重开修订。
