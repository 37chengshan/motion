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
- **AI生图管线**：文生图（SDXL/即梦/可灵）批量生成图标与背景 + 程序化布局（Mermaid/Manim/Remotion Shapes）保证文字清晰，二者叠加合成，非整图一键生成
- **默认运镜**：每张图解默认 Ken Burns 缓慢推拉 + 流动箭头 + 逐项揭示（stagger）+ 脉冲高亮，0.6-1.2s easeInOut，转场 Wipe/Fade 0.4s；动效是可选，运镜是必选

## 五、视觉生成三轨（对标 Milvus 天花板 691s 拆解）

> 该视频高级感 = 三轨视觉 + 默认运镜，非PPT翻页。307帧实测（AV1 1920×1080 1fps）见 `.ccg/tasks/milvus-video-ai-analysis/frames/` 与 `supplement-visual-motion.md`

| 轨 | 职责 | 工具 | 产出 | 对应 `timeline.json` 字段 |
|---|---|---|---|---|
| **A. AI底图轨** | 批量生成图标与背景（扁平矢量、科技渐变、人物/风景缩略图） | Doubao-Seedream 4.0 / Kling V2.1 / Kolors / ComfyUI SDXL；prompt 管线统一管理 | `assets/images/*.png` 4K 背景+图标，文字留空 | `visual_prompt: "flat vector, database cylinder, dark tech #0B1220, soft shadow"` |
| **B. 代码图轨** | 程序化排版保证文字清晰（B+树/分区/数据流/泳道） | Mermaid / Manim / SVG + Remotion Shapes / ECharts | `src/components/diagrams/*` SVG/Canvas，文字可检索 | `diagram_spec: { type: "bplus-tree", params: { nodes: [...] } }` |
| **C. 动画合成轨** | 叠加A+B，附加运镜与揭示 | Remotion / HyperFrames / @remotion/transitions | 单图解 = 背景图层 + 代码图层 + 运镜容器 | `camera: "kenburns|pan"`, `reveal: "stagger"`, `transition: "wipe"` |

**合成规则**：A轨不含文字 → B轨叠字 → C轨包 KenBurns 容器；三轨在 `BlockRenderer` 按 `diagram_spec` 分发，避免AI生图乱码。

**本项目现状**：已打通 `timeline.json → BlockRenderer`，待补 `diagrams/milvus/*`（ScalarIndexTree/VectorVsScalar/SegmentStates/PartitionScan）即达到 Milvus 视频同款。

## 六、视觉与运镜速查

| 层 | 手法 | 实现 | 在 Vido 中的组件 | 状态 |
|---|---|---|---|---|
| 图像 | 扁平矢量图解（B+树/分区/数据流） | 文生图图标 + 代码排版叠加 | `src/components/diagrams/*` | ⏳ 规划（M任务） |
| 运镜 | Ken Burns 推拉 / Pan 平移 / 流动箭头 | `KenBurns.tsx` / `FlowArrow.tsx`（SVG dashoffset） | 默认容器 `camera: "kenburns"` | ⏳ 规划 |
| 揭示 | 逐项 stagger / 脉冲高亮 | `StaggerCards` / `PulseHighlight` | `reveal: "stagger"` | ⏳ 规划 |
| 转场 | Wipe/Fade/Flip | `@remotion/transitions` | 章节切换 0.4s | ✅ 可用（已依赖） |

已实现文字动效 8 项见 `docs/effects.md` §一；运镜6项见该文档 §零。

## 七、项目结构

```
d:\vido\
├── .qoder/skills/            ← 三个技能（vido-ai-news / vido-open-source / vido-own-project）
├── hyperframes/ai-news/      ← HyperFrames 合成（AI 新闻，生成产物）
├── src/
│   ├── Root.tsx              ← 合成注册（calculateMetadata 读 timeline）
│   ├── data/types.ts         ← 数据契约（narration/url/highlight/section + camera/reveal + visual_prompt/diagram_spec）
│   ├── data/timeline.ts      ← Timeline Manifest 类型
│   ├── compositions/         ← VidoShort/VidoLong/BlockRenderer + 6 风格（含 dark-tech）
│   ├── components/effects/   ← 8 个已实现 + 6 个运镜规划（KenBurns/FlowArrow…）
│   ├── components/diagrams/  ← 领域图解库（Milvus/ES/PG/RabbitMQ，规划）
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

## 八、子文档索引（docs/）

| 文档 | 内容 |
|------|------|
| [docs/workflow.md](docs/workflow.md) | **共享工作流**（契约/timeline/TTS/审查/发布，三技能公共底座） |
| [docs/effects.md](docs/effects.md) | 动画·运镜·AI生图清单（含已实现✅/规划⏳与配方参数） |
| [docs/styles.md](docs/styles.md) | 6 种视觉风格（含 dark-tech 深色科技） |
| [docs/research-workflow.md](docs/research-workflow.md) | 调研打分自动化 |
| [docs/tts.md](docs/tts.md) | 配音流程（CosyVoice2） |
| [docs/publish.md](docs/publish.md) | 多平台发布与登录 |
| [docs/mac-format.md](docs/mac-format.md) | AI 分享视频格式 |
| [docs/faq.md](docs/faq.md) | 常见问题 |
| [补充](../.ccg/tasks/milvus-video-ai-analysis/report.md) | Milvus AI视频完整逆向报告 |
| [补充](../.ccg/tasks/milvus-video-ai-analysis/supplement-visual-motion.md) | AI生图与运镜 307帧实测 |

## 九、核心命令

| 命令 | 作用 |
|------|------|
| `npm run research` / `npm run score` | 15 信源采集 / AI 打分推荐 |
| `npm run tts` / `npm run timeline` / `npm run srt` | 旁白 / 时间轴 / 字幕 |
| `node scripts/gen-hyperframes.ts` | 生成 HyperFrames AI 新闻合成 |
| `npm start` | Remotion Studio 预览（项目类） |
| `npm run render:all` / `render:burned` | Remotion 双格式 / 字幕烧录版 |
| `npm run login` / `login:check` / `publish` | 平台登录 / 检查 / 发布 |
