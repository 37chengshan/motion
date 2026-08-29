# VIDO — 每日视频工作流

> 双渲染引擎的代码驱动视频生产系统：调研 → 审核选题 → AI 组装 → 旁白 → 渲染 → 审查 → 发布

## 一、内容类型与引擎路由（4 种）

| 类型 | 引擎 | 技能 | 流程 |
|------|------|------|------|
| A. AI 新闻日报（含其他新闻半场） | **HyperFrames**（HTML 幻灯片） | `vido-ai-news` | 15 信源调研 → AI 审核 → 组装 → 旁白 → 渲染 |
| B. 开源项目介绍（科普动画） | **Remotion**（React+3D+手绘） | `vido-open-source` | GitHub API 深抓 → 科普叙事 → 旁白 → 双格式 |
| C. 自有项目宣传（品牌定制） | **Remotion** | `vido-own-project` | 用户资料 → 品牌组装 → 旁白 → 双格式 |
| D. 真人操作录屏 | **Remotion**（MacDesktopFormat） | — | 屏幕录制素材 + 后期包装 |

## 二、输出格式

- **竖屏** 1080×1920 → 抖音 / 小红书
- **横屏** 1920×1080 → B站（外挂字幕）

## 三、每日工作流（以 AI 新闻为例）

```bash
# 1. 采集（15 信源：HN/GitHub/量子位/36氪/Solidot/IT之家/TechCrunch… + BBC/环球/中新网）
npm run research

# 2. AI 打分（热度0.4+时效0.3+来源0.3）→ Top 3 推荐卡
npm run score

# 3. AI 审核选题 + 用户确认 → 生成 today.json（含 narration，真实数据强制）

# 4. 旁白合成（CosyVoice2 优先，edge-tts 暂代）+ 时间轴 + 字幕
npm run tts && npm run timeline && npm run srt

# 5a. AI 新闻渲染（HyperFrames）
node scripts/gen-hyperframes.ts
cd hyperframes/ai-news && npx hyperframes lint && npx hyperframes render --output ../../out/ai_news_short.mp4

# 5b. 项目科普渲染（Remotion）
npm run render:all

# 6. proof frames 审查（timeline proofTimestamps 抽帧 + contact sheet）

# 7. 发布（用户确认后）
npm run login -- --platform douyin --headed   # 首次（抖音/小红书必须 --headed）
npm run publish -- --platform bilibili,douyin,xiaohongshu
```

## 四、核心机制

- **Timeline Manifest**（`out/timeline.json`）：唯一时间事实源——Remotion（calculateMetadata）、HyperFrames（data-* 属性）、SRT 字幕、proof 抽帧四处同源，杜绝音画错位
- **音画同步**：TTS 逐段合成 → ffprobe 读时长 → Sequence/Audio 同源对齐
- **内容真实化**：每条 block 强制真实数据（star/金额/版本号/URL），禁止空话
- **强审查**：lint/tsc → snapshot/抽帧 → contact sheet AI 审查 → 不合格外科手术式修复

## 五、项目结构

```
d:\vido\
├── .qoder/skills/            ← 三个技能（vido-ai-news / vido-open-source / vido-own-project）
├── hyperframes/ai-news/      ← HyperFrames 合成（AI 新闻，生成产物）
├── src/
│   ├── Root.tsx              ← 合成注册（calculateMetadata 读 timeline）
│   ├── data/types.ts         ← 数据契约（narration/url/highlight/section）
│   ├── data/timeline.ts      ← Timeline Manifest 类型
│   ├── compositions/         ← VidoShort/VidoLong/BlockRenderer + 5 风格
│   ├── components/effects/   ← 11 个动画组件（StatCounter/ComparisonCard/ProgressSteps…）
│   ├── components/templates/ ← ProjectSpotlight 科普模板
│   └── components/formats/   ← MacDesktopFormat
├── scripts/
│   ├── daily-research.ts     ← 15 信源采集+归档+回顾版
│   ├── score-and-rank.ts     ← ai-pulse 打分+去重+AI审核推荐卡
│   ├── tts-cosyvoice.py      ← TTS 双后端（CosyVoice2→edge-tts）
│   ├── prepare-audio.ts      ← timeline.json 生成（probe-first）
│   ├── gen-srt.ts            ← 字幕生成
│   ├── gen-hyperframes.ts    ← HyperFrames 合成生成器
│   ├── render-batch.ts       ← Remotion 批量渲染
│   ├── platform-login.ts     ← 平台扫码登录（--headed）
│   └── publish.ts            ← 多平台发布
├── research/                 ← today/ + archive/YYYY-MM-DD/
├── public/                   ← voiceover/ + timeline.json（Remotion 静态资源）
└── out/                      ← 渲染产物 + voiceover/ + timeline.json + proof/
```

## 六、子文档索引（docs/）

| 文档 | 内容 |
|------|------|
| [docs/workflow.md](docs/workflow.md) | **共享工作流**（契约/timeline/TTS/审查/发布，三技能公共底座） |
| [docs/effects.md](docs/effects.md) | 动画效果组件清单 |
| [docs/styles.md](docs/styles.md) | 5 种视觉风格规范 |
| [docs/research-workflow.md](docs/research-workflow.md) | 调研打分自动化 |
| [docs/tts.md](docs/tts.md) | 配音流程（CosyVoice2） |
| [docs/publish.md](docs/publish.md) | 多平台发布与登录 |
| [docs/mac-format.md](docs/mac-format.md) | AI 分享视频格式 |
| [docs/faq.md](docs/faq.md) | 常见问题 |

## 七、核心命令

| 命令 | 作用 |
|------|------|
| `npm run research` / `npm run score` | 15 信源采集 / AI 打分推荐 |
| `npm run tts` / `npm run timeline` / `npm run srt` | 旁白 / 时间轴 / 字幕 |
| `node scripts/gen-hyperframes.ts` | 生成 HyperFrames AI 新闻合成 |
| `npm start` | Remotion Studio 预览（项目类） |
| `npm run render:all` / `render:burned` | Remotion 双格式 / 字幕烧录版 |
| `npm run login` / `login:check` / `publish` | 平台登录 / 检查 / 发布 |
