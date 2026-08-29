---
name: ai-news-handbook
version: 1
updated_at: 2026-08-29
status: draft
proxy_required: []
blindtest:
  days: 0
  hit_rate: 0
  last_run: ""
---

# AI 新闻方向研究手册（全球 AI 动态）

方向定位：**全球 AI 动态**（厂商官方动作优先）。早晚双场次。
设计风格沿用既有 `claude`=暖米白 / `dark`=黑底青绿（用户既定，不另设计）。

> 本手册是 agent 的检索细节依据，由 SKILL.md 指向。修改需 bump version 并记录盲测。

## 一、信源表（三层）

### 主方案层（用户定：AIHOT 为主要信息来源）

| 信源 | 端点 | parser | 说明 |
|---|---|---|---|
| **AIHOT 精选（主源）** | `https://aihot.virxact.com/api/v1/items?mode=selected&window=24h&limit=50` | `aihot-json` | 中文 AI 精选（评分+推荐理由+分类），匿名免 key；已接入 daily-research 实测 8 条 |
| **AIHOT 模型榜** | `https://aihot.virxact.com/leaderboard` | html | 10 个权威榜加权共识分，排行榜配图/数据来源 |

> 精选条件请求：`If-None-Match` 用 ETag，间隔按 `s-maxage`（items 60s）；429 按 `Retry-After` 退避。

### 直连层（补充采集）

| 信源 | 端点 | parser | 说明 |
|---|---|---|---|
| OpenAI 官方博客 | `https://openai.com/blog/rss.xml` | rss | RSS 端点放行 Cloudflare，免代理，实测含当日条目 |
| Anthropic News | `https://www.anthropic.com/news` | rss | 官方发布与模型更新 |
| Google AI Blog | `https://blog.google/technology/ai/rss/` | rss | |
| IT之家 | `https://www.ithome.com/rss/` | rss | 国内科技快讯 |
| 量子位 | `https://www.qbitai.com/feed` | rss | 国内 AI 垂直 |
| HuggingFace Trending | `https://hf-mirror.com/models?sort=likes30d` | html | 国内镜像，免代理 |
| GitHub | `https://api.github.com/search/repositories` | github-search | REST 直调 + topic/stars 过滤 |

### X 层（一手源，厂商官号首发——最高优先级）

X 是**一手信息源**：厂商官方账号/官方员工最先在 X 首发官方动作，再被日报媒体转载。

- **主方案**：`twscrape` 轮询 `config/x-watchlist.json` 白名单（28 官方 + 18 员工/研究员），
  `api.user_tweets` 拉各账号当日新帖。
- **备援**：中文 AI 日报聚合（juejin 日报 / StormZhang / `ainews.liduos.com`）+ 厂商官方博客 RSS。
- **已死勿用**：Nitter（被 X 律师函永久关停）、snscrape（2023 停更）、Twint（2022 归档）。
- 白名单 handle 标注 `verify: false` 的项上线前需实测核验。

### 热榜层

| 信源 | 端点 | 说明 |
|---|---|---|
| 60s API | `https://60s.viki.moe/v2/ai-news` | **免费、免部署、MIT 开源**，首选 |
| HN | `hn.algolia.com/api/v1/search_by_date` | `points > 5` 过滤 |
| DailyHotApi | 自部署 `127.0.0.1:6688` | 备援；探测失败即跳过，不假设存活 |

## 二、检索式与过滤器

### 核心过滤器：仅厂商官方动作

盲测结论（n=23）：参考视频 **100% 只收「厂商官方动作」**，0% 收财报解读 / 宏观 / 社会应用类。
漏项集中在：X 官方与员工帖（39%）、官方博客、模型平台发布。

**收录白名单**（厂商官方动作）：
- 产品/模型发布（release、launch、introducing、announcing）
- 功能更新（now available、GA、rolling out）
- 官方研究成果（论文/技术报告，须厂商或实验室官方发布）
- 厂商法律事件（诉讼、监管处罚、合规公告）

**排除黑名单**：
- 财报解读 / 股价分析 / 融资传闻
- 宏观经济 / 行业趋势评论
- 社会应用 / 伦理讨论（除非厂商官方立场）
- 第三方观点、纯评测对比（除非来自 Artificial Analysis 等权威评测）

### 关键词族

```
发布类：release, launch, introducing, announcing, unveil, GA, generally available
更新类：now available, rolling out, update, upgrade, new feature
研究类：paper, technical report, research, benchmark
法律类：lawsuit, sue, regulatory, antitrust, compliance, ban
```

### GitHub 检索式（REST 直调）

```
https://api.github.com/search/repositories?q=<topic>+created:>{date}+stars:>=5&sort=stars
```

- **必须 URL 编码** `created:>` 中的 `>` 为 `%3E`
- 走 REST API 而非 `gh` CLI（后者实锤丢弃 `created:` 限定符）
- 需配 `GITHUB_TOKEN`：未认证 60 次/时 → 认证 5000 次/时（83 倍）

## 二点五、配图与素材策略（用户定：增强可信度）

素材取图优先级（`media` 字段落 run 目录 `media/b<idx>-<kind>.png`）：

| 场景 | 素材来源 | media.kind | 说明 |
|---|---|---|---|
| 厂商官方发布/功能更新 | **X 官方帖截图**（厂商/官方员工账号） | `screenshot` | 一手证据，配图可信度最高 |
| 榜单/评测 | AIHOT 模型榜 / leaderboard 高亮截图 | `leaderboard` | 共识分可视化 |
| 官方研究/论文 | 论文架构图/结果图 | `figure` | |
| 生成能力演示 | 模型输出帧 | `output-frame` | |
| 无素材 | 卡片页（不强行配图） | — | 降级为纯文字卡 |

- **截图机制**：headless 浏览器（`.remotion/chrome-headless-shell` 或 Playwright）抓官方帖/榜单页 → 落 `runs/<date>/<run>/media/`
- **配图规则**：官方发布→X 帖截图；榜单→leaderboard 高亮；论文→架构图；无素材→卡片页
- X 截图需能访问 x.com（已确认）；微博官方发文截图策略见 cn-news 手册

## 三、降级链| 层 | 主方案 | 降级 1 | 降级 2 | 终点 |
|---|---|---|---|---|
| X | twscrape(cookie) | 中文日报聚合 | — | 空 + 标注「X 不可用」 |
| 直连 RSS | 原端点 | 备用镜像 | — | 空 + 记入 source-health |
| GitHub | 配 PAT | 未认证 60次/时 | — | 跳过 |
| 热榜 | 60s API | m.weibo.cn | 知乎热榜 → DailyHotApi | 空热榜 + 标注「热榜不可用」 |

**硬规则**：降级链终点必须是「空 + 标注」，不得假设未部署服务存活（如 6688）。

## 四、打分权重

沿用 `score-and-rank.ts` 的 ai-pulse 模型：

```
total = heat * 0.4 + timeliness * 0.3 + sourceQuality * 0.3
```

- **来源质量加成**：`trust_level=high`（厂商官方博客、官方 X 账号）加权
- **一手源加成**：X 官方账号首发 > 日报转载 > 二手解读
- **一票否决**：无具体数字 / 无来源链接 / 纯观点无事实

去重：bigram Jaccard 相似度 > 0.8 判重（`score-and-rank.ts` 内置）。

## 五、盲测记录表

| 日期 | 手册版本 | 参考条目数 | 命中 | 半命中 | 命中率 | 备注 |
|---|---|---|---|---|---|---|
| — | v1 | — | — | — | — | 初始版本，未盲测 |

**定稿规则**：连续 3 天 `hit_rate >= 0.80` 且覆盖 ≥2 个不同工作日 → `status: stable`；
定稿后降频每周 1 次回归，连续 2 周跌破 70% 触发手册重开修订。
