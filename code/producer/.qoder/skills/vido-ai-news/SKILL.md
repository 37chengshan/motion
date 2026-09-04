---
name: vido-ai-news
description: 制作每日四方向新闻视频（AI 新闻 / 国际新闻 / 国内新闻 / 娱乐新闻），使用 HyperFrames 引擎渲染幻灯片式新闻视频。当用户要"做今日新闻/AI 日报/国际新闻/国内新闻/娱乐新闻/每日速报"、提到 news-slideshow 时使用。流程：主持代理派 4 子代理检索 → 跨方向查重 → 人工确认选题 → 深抓真实化 → TTS 旁白 → HyperFrames 渲染 → 整片审查。
---

# Vido 新闻日报（四方向 · HyperFrames 引擎）

## 四方向架构

| 方向 | stream | 配额 | 场次 | 语气/风格 |
|---|---|---|---|---|
| **AI 新闻**（全球 AI 动态） | `ai-news` | 3 条 | **早晚双场** | 专业克制带参数；风格 `claude` 暖米白 / `dark` 黑底青绿（既定） |
| **国际新闻** | `intl-news` | 3 条 | 单场 | 严肃通讯社腔 |
| **国内新闻** | `cn-news` | 2 条 | 单场 | 平实 official 腔 |
| **娱乐新闻**（国内外） | `ent-news` | 3 条 | 单场 | 轻快但不轻浮 |

**每天产出**：AI 早晚 2 场 + 其余三方向各 1 场 = **5 个视频**。
总条数区间 9-11 条/场。

> **本 skill 是目录与流程**。检索细节（信源表/检索式/过滤器/降级链/打分权重）一律查
> `config/research-handbooks/`；提示词全文在 `config/prompt-templates/`；
> 渲染契约细节见 [reference.md](reference.md)。

## 执行主体

**你是 agent，本身就是 LLM**——选题、写分镜 blocks、写旁白全部由你（及你派的子代理）直接产出，
**不需要调用 LLM API**。脚本只是机械工具（采集/打分/TTS/时间轴/渲染/审查/打包）。

- 主持代理提示词：`config/prompt-templates/host.v1.md`
- 四方向子代理：`config/prompt-templates/{ai,intl,cn,ent}-subagent.v1.md`

## 场次时间窗

| 场次 | 内容窗口 | 约定执行时间 |
|---|---|---|
| morning | 昨 08:00 → 今 08:00 | 08:00 |
| evening | 今 06:00 → 17:30 | 18:00 |

AI 方向早晚双场（候选池互斥）；其余三方向每天单场。
晚报需传入当日早场已入选清单（`{{EDITION_HISTORY}}`）：对已报道事件仅当**有新进展**才再入选。
23:00-06:00 只产 evening 场。

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

> 四方向由**主持代理**调度：读 `config/prompt-templates/host.v1.md`，并行派 4 个子代理。
> 以下 1-3 为选题阶段（agent 主导），4-8 为生产阶段（脚本机械执行）。

### 1. 采集（脚本，四方向各自独立 run）

```bash
# --date 与 --stream 均为必填（脚本禁止自取系统日期）
node scripts/daily-research.ts --date 2026-08-30 --stream ai-news  --edition morning
node scripts/daily-research.ts --date 2026-08-30 --stream intl-news --edition morning
node scripts/daily-research.ts --date 2026-08-30 --stream cn-news   --edition morning
node scripts/daily-research.ts --date 2026-08-30 --stream ent-news  --edition morning

# 各自打分
node scripts/score-and-rank.ts --run-dir runs/2026-08-30/ai-news-morning --stream ai-news
```

输出：`runs/<date>/<run>/research/{raw,scored,top.md,selection-candidates}.json`。
信源只从 `config/news-sources.json` 注册表读取；单源失败可跳过，
全部实时源失败则 `source_unavailable=true` 并退出非零。

**X 一手源**（AI 方向最高优先级）：`twscrape` 轮询 `config/x-watchlist.json` 白名单
（28 官方 + 18 员工/研究员），厂商官号首发官方动作。降级：中文 AI 日报聚合 → 空 + 标注。
Nitter/snscrape/Twint **已死勿用**。

### 2. 四方向选题（agent 主导，必须做）

按 `host.v1.md` 执行：
1. **并行派 4 子代理**（各读对应 handbook），超时 **12 分钟**
2. **跨方向查重**：规范化标题 + 核心实体 + 数字指纹三者综合；
   同一事件多方向命中时保留最贴方向的一条（AI 垂类优先归 `ai-news`）
3. **配额校验**：总量 9-11 条；不足从候选池补位，超出按 `total` 截断
4. **degraded 补位**：子代理超时/失败时
   `node scripts/score-and-rank.ts --fallback-only --run-dir <run> --stream <stream>`
   按 stream 分组取 top，写入统一 `selection.json`（`selected_by: "score-fallback"`），
   **不开第二输入分支**

### 3. 人工确认（AskUserQuestion，禁止跳过）

展示每条：标题 + 方向 + 来源 + 为什么选它 + 视频化角度；
标注 degraded 补位项与查重剔除项。用户确认后写入
`runs/<date>/<run>/research/selection.json`。

### 4. 内容生成与深抓真实化

读 research/today/top.md 与 scored.json，逐条判断：
- 视频化价值：有无画面素材/数据可高亮（star 数/百分比/金额）
- 受众相关：AI 新闻挑 3 条 + 其他新闻挑 3 条
- 淘汰空话条目（无具体数字/无来源的）

用 AskUserQuestion 展示 Top 3 推荐卡（含"为什么选它/视频化角度/旁白要点"）让用户确认，或用户直接指定。

深抓选中新闻的原文（快照 + SHA256 绑定 `sourceSnapshotHash`）：
- 每条新闻卡必须多模块（文字是信息主体，静音也能看懂）：
  - `summary`：2-4 句详细摘要（含具体数据，禁止空话）
  - `stats`：3-4 个数据卡 `[{label, value}]`（关键数字可视化）
  - `points`：3-5 条要点（事件细节/背景/影响）
  - `highlight`（高亮数字）、`source`（来源）、`url`（真实链接）
  - `tag`（方向徽章，可选）、`media`（素材图，可选）、`subtitle`（内嵌字幕条 10-28 字）
- 摘要禁止虚构：正文抓不到就用标题事实 + HN 互动数据（points/comments）
- 国际新闻翻译规范：原文标题+中文翻译并存，关键数据照搬
- 信息密度要求：每条新闻至少 80 字摘要 + 3 数据卡 + 3 要点；宁多勿少
- **每个事实必须绑定 `sourceSnapshotHash`**；缺失时 `generate-content` 会校验失败

**旁白时长配速**（防总时长超 360s）：
- 中文语速按 4.5 字/秒反推：普通单段 65-100 字（14-22s）、两段式 135-180 字（30-40s）
- 固定开销（开场+总览+收尾）约 20s；9-11 条中两段式 ≤7 的组合均 ≤360s
- 超限削减顺序：两段式降单段 → 普通条压 14s 下限 → 砍条目至配额下限
- `prepare-audio` 有硬门：总时长 >360s 直接 exit 1 不写 timeline

### 5. 生成 content.json（run 目录，四方向）

```bash
node scripts/generate-content.ts --run-dir runs/2026-08-30/ai-news-morning \
  --date 2026-08-30 --stream ai-news --edition morning \
  --selection runs/2026-08-30/ai-news-morning/research/selection.json
```

风格：`style: "claude"`（暖米白橙棕，文字优先）/ `style: "dark"`（黑底青绿高对比）。
AI 方向沿用这两套（既定）；其余三方向各自成风格。

**section 取值（四方向，写错会被校验拦截）**：

| stream | section 允许值 |
|---|---|
| `ai-news` | `ai-news` \| `review-ai` |
| `intl-news` | `intl-news` \| `review-other` |
| `cn-news` | `cn-news` \| `review-other` |
| `ent-news` | `ent-news` \| `review-other` |

block 结构示例（四方向通用）：

```json
{
  "type": "ai-news", "engine": "hyperframes", "template": "news-slideshow",
  "style": "claude", "title": "AI 新闻日报 · 2026-08-30 早场",
  "blocks": [
    {"type": "title", "content": "今日速报", "section": "review-ai", "narration": "…"},
    {"type": "text", "content": "<中文标题>", "summary": "…", "stats": [{"label":"…","value":"…"}],
     "points": ["…"], "highlight": "…", "source": "…", "url": "…",
     "section": "ai-news", "narration": "…", "subtitle": "10-28 字压缩标题"}
  ]
}
```

**TTS 语气按方向**：AI=沉稳男声标准速 / 国际=播报腔 rate -5% / 国内=标准官播 / 娱乐=明快女声 rate +5%。

### 6. 旁白合成 + 时间轴（run 内隔离）

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

### 7. 生成 HyperFrames 合成并渲染（双格式）

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

### 8. 审查与交付

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

### 9. 登记预览台 → 停在草稿（流程必做）

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
