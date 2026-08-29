---
name: intl-news-handbook
version: 1
updated_at: 2026-08-29
status: draft
proxy_required:
  - Google News RSS
  - GDELT
  - r.jina.ai
blindtest:
  days: 0
  hit_rate: 0
  last_run: ""
---

# 国际新闻方向研究手册

方向定位：**国际新闻**（一般国际时事，非 AI 垂类——AI 国际动态归 `ai-news`）。每天单场。

> 本手册是 agent 的检索细节依据，由 SKILL.md 指向。修改需 bump version 并记录盲测。

## 一、信源表（三层）

### 直连层（免代理，当前可用）

| 信源 | 端点 | 覆盖面向 | 说明 |
|---|---|---|---|
| TechCrunch | `https://techcrunch.com/feed/` | 科技/商业 | 国际科技商业主线 |
| The Verge | `https://www.theverge.com/rss/index.xml` | 科技/政策 | 科技政策与平台动态 |
| VentureBeat | `https://venturebeat.com/feed/` | 商业/科技 | 企业级科技 |
| ArsTechnica | `https://feeds.arstechnica.com/arstechnica/index` | 科技/政策 | 深度科技与政策分析 |
| Solidot | `https://www.solidot.org/index.rss` | 科技 | **国内视角**的国际科技，交叉验证用 |
| 环球网国际 | `https://rss.huanqiu.com/world.xml` | 政策/社会 | **国内视角**国际时事 |
| 中新网国际 | `https://www.chinanews.com.cn/rss/scroll.xml` | 社会/政策 | **国内视角**，官方口径 |

### 需代理但未启用（本机当前无代理，勿调）

| 信源 | 用途 | 状态 |
|---|---|---|
| Google News RSS | 多源聚合检索 | **需代理，当前不可用** |
| GDELT | 全球事件数据库 | **需代理，当前不可用** |
| r.jina.ai | 正文提取 | **需代理，当前不可用** |

> 代理就绪后按上表启用，并同步更新 `proxy_required` 与本表状态。

### 热榜层

| 信源 | 端点 | 说明 |
|---|---|---|
| 60s API | `https://60s.viki.moe/v2/60s` | 每日国际国内要闻摘要（微信公众号源） |
| DailyHotApi | 自部署 `127.0.0.1:6688` | 备援；探测失败即跳过 |

## 二、检索式与过滤器

### 四主题矩阵

国际时事按四个面向覆盖，保证选题不偏科：

| 主题 | 说明 | 典型关键词 |
|---|---|---|
| **科技** | 科技巨头、平台、前沿技术 | tech, platform, AI, chip, semiconductor, launch |
| **商业** | 企业并购、市场、贸易 | merger, acquisition, market, trade, IPO, earnings |
| **政策** | 立法、监管、国际关系 | regulation, policy, bill, treaty, summit, sanction |
| **社会** | 重大社会事件、灾害、公共议题 | incident, protest, disaster, election, ruling |

### law 词族（法律与政策事件检索）

```
lawsuit, sue, court, ruling, verdict, appeal
regulatory, regulation, antitrust, compliance, fine, penalty
ban, sanction, restriction, embargo, tariff
legislation, bill, act, executive order, directive
EU AI Act, GDPR, DMA, DSA
```

### 收录标准

- 有明确主体（国家/机构/企业）+ 明确事件 + 可追溯来源
- 时效性：优先 24-48 小时内事件
- 国内视角源（solidot/huanqiu/chinanews）与国际源**交叉验证**：两边都报的事件可信度更高

### 排除标准

- 纯评论/观点文章（无事实）
- 无具体时间地点的模糊报道
- 娱乐八卦（归 `ent-news`）
- AI 垂类产品发布（归 `ai-news`）

## 三、降级链

| 层 | 主方案 | 降级 1 | 降级 2 | 终点 |
|---|---|---|---|---|
| 国际 RSS | TechCrunch/Verge/VB/Ars | solidot | huanqiu/chinanews | 空 + 标注「国际源不可用」 |
| 热榜 | 60s API `/v2/60s` | DailyHotApi(6688) | — | 空热榜 + 标注 |
| 需代理源 | — | — | — | **直接跳过**，不重试不等待 |

**硬规则**：降级链终点必须是「空 + 标注」，不得假设未部署服务存活（如 6688）；需代理源直接跳过，不消耗时间重试。

## 四、打分权重

沿用 `score-and-rank.ts` 的 ai-pulse 模型：

```
total = heat * 0.4 + timeliness * 0.3 + sourceQuality * 0.3
```

方向特有加成：
- **交叉验证加成**：国际源与国内视角源同时报道 → sourceQuality 加权
- **主题均衡**：单日选题尽量覆盖四主题矩阵，避免全部集中在科技主题
- **一票否决**：无明确主体 / 无来源链接 / 纯观点无事实

去重：bigram Jaccard 相似度 > 0.8 判重（`score-and-rank.ts` 内置）。

## 五、盲测记录表

| 日期 | 手册版本 | 参考条目数 | 命中 | 半命中 | 命中率 | 备注 |
|---|---|---|---|---|---|---|
| — | v1 | — | — | — | — | 初始版本，未盲测 |

**定稿规则**：连续 3 天 `hit_rate >= 0.80` 且覆盖 ≥2 个不同工作日 → `status: stable`；
定稿后降频每周 1 次回归，连续 2 周跌破 70% 触发手册重开修订。

## 六、内容安全红线

- 国际政治敏感话题**照官方口径**表述，不做主观倾向性解读
- 涉华议题以国内官方源（huanqiu/chinanews）口径为准
- 引文 ≤40 字 + 标注 credit + 附 disclaimer
- 不收录未经官方确认的传闻与单一匿名信源
