---
name: vido-ai-news
description: 制作每日 AI 新闻日报视频（含其他/国际新闻半场），使用 HyperFrames 引擎渲染幻灯片式新闻视频。当用户要"做今日 AI 新闻/AI 日报/每日新闻视频"、提到 news-slideshow 或每日速报时使用。流程：15 信源调研 → AI 审核选题 → 真实内容组装 → CosyVoice2 旁白 → HyperFrames 渲染 → proof frames 审查。
---

# Vido AI 新闻日报（HyperFrames 引擎）

制作结构：开场总评（第一评 AI 新闻汇总 + 第二评其他新闻汇总）→ 前半场 AI 新闻详情 → 后半场其他/国际新闻详情。竖屏 1080×1920，时长 1.5-3 分钟。

共享底座（数据契约/timeline/TTS/审查/发布）见 [docs/workflow.md](../../../docs/workflow.md)——先读它。

## 早晚双场次（默认模式）

每天两场，产物全程按场次隔离（`<场次>` = morning | evening）：

| 场次 | 内容窗口（有意重叠） | 约定执行时间 |
|---|---|---|
| morning | 昨 08:00 → 今 08:00 | 08:00 |
| evening | 今 06:00 → 17:30 | 17:30 |

**run 目录契约**（所有产物隔离在 run 内，不再读写 `out/`、`public/`、`src/data/today*.json` 单例）：

- run id 格式：`<stream>-<edition>-<date>`（如 `ai-news-morning-2026-08-30`）
- 数据：`runs/<date>/<run>/research/raw.json` → `scored.json`
- 内容：`runs/<date>/<run>/config/content.json`
- 音频：`runs/<date>/<run>/audio/{i}.wav` → `runs/<date>/<run>/timeline/timeline.json`
- 字幕：`runs/<date>/<run>/timeline/subtitle.srt`
- 合成：`runs/<date>/<run>/hyperframes/hf-<run>-short/`
- 断点续跑（幂等）：每阶段完成后 `node scripts/stage.ts done <run_id> <阶段>`；重入时先
  `node scripts/stage.ts next <run_id> research,score,select,script,media,voiceover,timeline,compose,render,review,package`
  跳过已完成阶段（阶段名以 `scripts/stage.ts` 的 `STAGE_ORDER` 为准）
- 跑完登记预览台并停在草稿（见末节）

## 完整流程

### 1. 调研采集

```bash
# --date 与 --stream 均为必填（脚本禁止自取系统日期）
# 窗口自动计算：morning=昨08:00→今08:00 / evening=今06:00→17:30
node scripts/daily-research.ts --date 2026-08-30 --stream ai-news --edition morning
node scripts/score-and-rank.ts --run-dir runs/2026-08-30/ai-news-morning --stream ai-news
```

输出：`runs/<date>/<run>/research/{raw,scored,top.md,selection-candidates}.json`。
信源只从 `config/news-sources.json` 注册表读取，脚本不硬编码 URL；单源失败可跳过，
全部实时源失败则 `source_unavailable=true` 并退出非零。

海外源（BBC/Reuters）可能被墙自动降级；需要更多国际新闻时用 agent-reach 搜索补充（`bili search` / Exa / `curl r.jina.ai`）。

### 2. AI 审核选题（必须做，禁止跳过）

读 research/today/top.md 与 scored.json，逐条判断：
- 视频化价值：有无画面素材/数据可高亮（star 数/百分比/金额）
- 受众相关：AI 新闻挑 3 条 + 其他新闻挑 3 条
- 淘汰空话条目（无具体数字/无来源的）

用 AskUserQuestion 展示 Top 3 推荐卡（含"为什么选它/视频化角度/旁白要点"）让用户确认，或用户直接指定。

### 3. 内容真实化 + 多模块化（核心规则）

深抓选中新闻的原文（`curl -s "https://r.jina.ai/<url>"` 或直接读标题内数据）：
- 每条新闻卡必须多模块（文字是信息主体，静音也能看懂）：
  - `summary`：2-4 句详细摘要（含具体数据，禁止空话）
  - `stats`：3-4 个数据卡 `[{label, value}]`（关键数字可视化）
  - `points`：3-5 条要点（事件细节/背景/影响）
  - `highlight`（高亮数字）、`source`（来源）、`url`（真实链接）
- 摘要禁止虚构：正文抓不到就用标题事实 + HN 互动数据（points/comments）
- 国际新闻翻译规范：原文标题+中文翻译并存，关键数据照搬
- 信息密度要求：每条新闻至少 80 字摘要 + 3 数据卡 + 3 要点；宁多勿少

### 4. 生成 today.json（场次版）

```bash
# 场次模式：写入 src/data/today.<场次>.json（模板同下，结构不变）
# 单场模式：写入 src/data/today.json
```

风格：只保留两种视觉风格（`style: "claude"` 默认 / `style: "dark"`），
详见 docs/workflow.md 六-C（claude=暖米白橙棕文字优先；dark=黑底青绿高对比）。

```json
{
  "type": "ai-news", "engine": "hyperframes", "template": "news-slideshow",
  "style": "claude", "title": "今日 AI 速报",
  "subtitle": "YYYY-MM-DD · AI 与世界新闻日报",
  "blocks": [
    {"type": "title", "content": "今日 AI 速报", "section": "review-ai", "narration": "…"},
    {"type": "list", "content": "今日 AI 三件事", "items": ["…","…","…"], "section": "review-ai", "narration": "…"},
    {"type": "list", "content": "今日世界三件事", "items": ["…","…","…"], "section": "review-other", "narration": "…"},
    {"type": "text", "content": "AI 新闻", "section": "review-other", "narration": "…"},
    {"type": "text", "content": "<中文标题>", "summary": "<2-4 句摘要>", "stats": [{"label":"…","value":"…"}], "points": ["…"], "highlight": "<高亮数字>", "source": "<来源>", "url": "<真实链接>", "section": "ai-news", "narration": "…"},
    …（AI 3-4 条）
    {"type": "text", "content": "世界新闻", "section": "ai-news", "narration": "…"},
    …（其他 3-4 条，section: "other-news"）
  ]
}
```

结构比例：总评约 25%，AI 半场 37%，其他半场 37%。每条 narration 1-2 句口语化。

### 5. 旁白合成 + 时间轴（run 内隔离）

```bash
# TTS：逐段生成 runs/<date>/<run>/audio/{i}.wav（CosyVoice2 优先，edge-tts 暂代）
npm run tts -- --out runs/2026-08-30/ai-news-morning/audio

# 时间轴（唯一时间事实源，ffprobe 逐段读时长）
npm run timeline:run -- --run-dir runs/2026-08-30/ai-news-morning
#   → runs/<date>/<run>/timeline/timeline.json

# 外挂字幕（从 timeline 生成，供平台字幕轨）
npm run srt:run -- --run-dir runs/2026-08-30/ai-news-morning
#   → runs/<date>/<run>/timeline/subtitle.srt
```

**注意命令名是 `timeline:run` / `srt:run`**（不是 `timeline` / `srt`）。
`prepare-audio` 硬性校验：有 narration 必须有对应 wav、ffprobe 失败即失败、孤儿 wav 即失败，全程不静默降级。
edge-tts 偶发失败用补跑模式：单段重试 8 次×3s。

### 6. 生成 HyperFrames 合成并渲染（双格式，场次隔离）

```bash
# --run-dir 必填（缺失直接 exit 1）；--orientation 默认 short，long 为 B站横屏版
node scripts/gen-hyperframes.ts --run-dir runs/2026-08-30/ai-news-morning --orientation short
node scripts/gen-hyperframes.ts --run-dir runs/2026-08-30/ai-news-morning --orientation long

# 进入合成目录执行 CLI（产物落在 run 内）
cd runs/2026-08-30/ai-news-morning/hyperframes/hf-ai-news-morning-2026-08-30-short
npx hyperframes check --strict     # 必须 0 error
npx hyperframes snapshot --at 2,10,25,45,65,75
npx hyperframes render --output ../../renders/ai_news_short.mp4
cd ../hf-ai-news-morning-2026-08-30-long
npx hyperframes render --output ../../renders/ai_news_long.mp4
```

**判定要点**：`check --strict` 失败时**退出码仍为 0**，必须按输出文本中是否含 `Check failed` 判定，不能只看退出码。

BGM：content.json 加 `"bgm": "bgm/bgm.mp3"` → 生成器自动加铺底音轨 + ducking 关键帧（旁白段 0.15/间奏 0.5）。

页面类型自动路由（gen-hyperframes.ts 内置）：title→开场页 / list→总评页 / 短 text 无 url→分区页 / text+url→新闻卡页。

### 7. 审查与交付

- 看 `runs/<date>/<run>/hyperframes/*/snapshots/`（AI 快筛：文字溢出/数字正确/无空白帧）
- **整视频终审（必做，替代单帧抽查）**：
  ```bash
  npm run review:video -- runs/2026-08-30/ai-news-morning/renders/ai_news_short.mp4 \
    --kind render --effort high \
    --config runs/2026-08-30/ai-news-morning/config/content.json \
    --timeline runs/2026-08-30/ai-news-morning/timeline/timeline.json
  ```
  模型完整观看整段视频，核对数据快照/文字溢出/动画冻结/黑帧/时序错位，输出 review 报告；
  verdict=fail 时退出码 1 → 必须修复重渲
- 交付 `runs/<date>/<run>/renders/` 下成片；横屏版用 `--orientation long` 重渲
- 发布需用户确认

### 8. 登记预览台 → 停在草稿（流程必做）

```bash
node scripts/stage.ts done ai-news-morning-2026-08-30 review
node scripts/dashboard-add.ts --type ai-news --edition morning \
  --video runs/2026-08-30/ai-news-morning/renders/ai_news_short.mp4 \
  --title "<今日标题>" --accounts "<平台>:<账号>,..."
```

登记后通知用户打开 http://localhost:4399 审阅；**禁止自动点发布**（草稿闸口默认开启，`npm run publish` 不传 `--no-draft-mode` 即停在草稿）。

## 常见问题

- HyperFrames lint 报同 track 重叠：gen 脚本已自动减 0.01s 规避，重新生成即可
- 字体警告（font_family_without_font_face）：用 sans-serif 系统字体名，忽略警告
- 音频文件找不到：脚本自动复制到 hyperframes/ai-news/assets/voiceover/，勿手动改路径
- 修改单个新闻卡：改 today.json 对应 block → 重跑 gen → lint → render（时间轴不动则音画不乱）
