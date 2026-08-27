# 每日调研打分自动化

> 脚本：`scripts/daily-research.ts` + `scripts/score-and-rank.ts`

## 流程总览

```
多源采集 → 5 维度打分 → Top 3 推荐卡 → 用户选择 → 生成视频配置 → 渲染
```

## 一、数据源（7 个）

| # | 来源 | 接入方式 | 状态 |
|---|------|---------|------|
| 1 | Hacker News | Algolia API（免 key） | ✅ 已实现 |
| 2 | GitHub Trending | GitHub Search API | ✅ 已实现 |
| 3 | Product Hunt | GraphQL API（需 token） | 待接入 |
| 4 | arXiv cs.AI | export API | 待接入 |
| 5 | Reddit r/MachineLearning | JSON API | 待接入 |
| 6 | 机器之心 / 36kr | RSS | 待接入 |
| 7 | X/Twitter AI KOL | agent-reach twitter | 待接入 |

## 二、5 维度打分模型

| 维度 | 权重 | 计算方式 |
|------|------|---------|
| 热度 | 30% | log 归一化 HN points / GitHub stars |
| 新颖性 | 25% | 标题关键词 + 是否首次发布 |
| 实用性 | 20% | 是否工具/框架/可上手 |
| 视频化潜力 | 15% | 有无 demo / 可视化素材 |
| 时效性 | 10% | 指数衰减（半衰期 5 天） |

> 当前为启发式规则，可替换为 LLM 打分：将标题+摘要发给 LLM，让模型输出各维度 0-10 分。

## 三、输出产物（research/today/）

- `raw.json` — 采集原始数据
- `scored.json` — 全量打分结果
- `top.md` — Top 3 推荐卡（供用户选择）

## 四、定时任务（GitHub Actions）

```yaml
# .github/workflows/daily-research.yml
name: daily-research
on:
  schedule:
    - cron: "0 2 * * *"  # 每天北京时间 10:00
  workflow_dispatch:
jobs:
  research:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run research && npm run score
      - uses: actions/upload-artifact@v4
        with:
          name: research-${{ github.run_id }}
          path: research/today/
```

## 五、参考项目

- last30days-skill（58K+）— 跨平台调研
- Agent-Reach（70K+）— AI Agent 联网，15+ 平台
- ai-daily-digest / CloudFlare-AI-Insight-Daily — 每日摘要生成
- Open Source Radar — 开源项目雷达
