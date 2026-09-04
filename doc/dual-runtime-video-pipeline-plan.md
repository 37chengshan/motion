# 每日双日报与双机视频生产发布系统重构计划

> 来源：`local://daily-dual-runtime-video-pipeline-plan.md`（会话内计划工件），落盘于 2026-08-28 供仓库内审阅。执行状态以 todo 为准。

## Context

把当前单仓库中的 `vido/` 视频生产代码与根目录 `backend/` Mac Publisher Node 重构为一个单仓库、两个运行面：Windows 负责全部内容生产与成片验收，Mac 只负责接收已验收发布包、账号会话、草稿/定时发布和回执；新增 Cloud Run 公网控制面与 Cloud Storage/Firestore 中转，使 Mac 白天离线、晚间回家后仍能可靠增量接收。每日生产拆为 AI 新闻日报早/晚两场、世界新闻日报早/晚两场、每日 GitHub 项目介绍 1–2 个；日报和 GitHub 日更统一走 HyperFrames 批量渲染，周末的 GitHub 精品介绍与自有项目介绍走 Remotion 定制渲染。

声音合成继续由 Windows 侧完成，Mac 不运行 TTS、FFmpeg、HyperFrames、Remotion 或模型；交接包必须携带已渲染视频、字幕、封面、平台元数据、整片审查报告和 SHA-256 清单。用户提供的测试用 AIPING 配置只允许通过环境变量注入，计划、代码、日志和生产配置都不得写入 key 原文。

## Approach

### 1. 固化双运行面目录和安装边界

1. 将当前 `vido/` 整体迁移为 `producer/`，保留其 `package.json`、`src/`、`scripts/`、`hyperframes/`、`style-previews/`、`dashboard/`、`docs/`、`repost/` 与现有 5 块测试数据作为生产端代码和 fixture；所有脚本中的 `process.cwd()` 约定改为从 `producer/` 运行，并把注释、默认路径和命令中的 `vido/` 更新为 `producer/`。
2. 将当前根目录 `backend/` 与 `tests/`、`pyproject.toml`、`requirements.txt` 迁移到 `publisher/`，形成 `publisher/backend/`、`publisher/tests/`、`publisher/pyproject.toml`、`publisher/requirements.txt`；把 Python 包内相对导入保持为 `backend.*`，把测试 import 保持为 `backend.*`，测试入口统一为 `cd publisher && python -m pytest -v`。不删除测试 fixture，不保留旧路径兼容别名。
3. 新增共享契约目录 `contracts/`，以 JSON Schema 与示例包定义跨机交接；Windows 与 Mac 不直接共享 SQLite，Cloud Run 只保存任务索引和包元数据，账号 Cookie、浏览器 profile、OAuth token 永不进入 `contracts/`、Cloud Storage 或 Firestore。
4. 把项目级 skill 的唯一安装目录定为根目录 `.agents/skills/`，用 `skills.lock.json` 记录仓库 URL、skill 名称、提交版本和安装日期；使用 Skills CLI 的 `--copy` 项目级安装，不使用全局安装。保留现有 `producer/.qoder/skills/` 作为旧测试 fixture，生产路由只读 `.agents/skills/`。
5. 安装并锁定这些真实来源：`feicaiclub/video-spec-builder` 的 `video-spec-builder`；`bradautomates/claude-video` 的 `watch`；`heygen-com/hyperframes` 的 `hyperframes`、`hyperframes-core`、`hyperframes-animation`、`hyperframes-keyframes`、`hyperframes-creative`、`hyperframes-cli`、`media-use`、`hyperframes-audio`、`hyperframes-registry`；`geeklee/srt-vox-director`、`geeklee/srt-whiteboard-animation`、`geeklee/whiteboard-stream-animation`；`Pluviobyte/video-production-skills` 的 `ai-motion-director` 与 `reference-video-replica-qc`；`iart-ai/motion-design-skills` 中与视频相关的 `animation-principles`、`shot-composition`、`motion-art-direction`、`beat-sync-editing`、`remotion-video`，以及 `iart-ai/web-animation-skills` 的 `gsap-web`、`60fps-animation`、`svg-animation`、`lottie-animation`。执行前必须逐项验证仓库存在、skill 名称精确（不静默装相近名）。
6. 因公开搜索没有发现名为 `video-agency-roles`、`motion-design`、`hyperframes-media` 的同名可安装仓库，新增三个项目内编排 skill：`.agents/skills/video-agency-roles/SKILL.md` 负责选题、事实、开发者视角、视觉、审美、节奏、平台包装的顺序门；`.agents/skills/motion-design/SKILL.md` 负责把镜头映射到 HyperFrames/GSAP/Remotion 动效规则；`.agents/skills/hyperframes-media/SKILL.md` 负责素材、音频、字幕、时间轴和渲染交接。它们只编排已锁定的原子 skill，不复制其正典表格。
7. 更新根 `README.md` 为双运行面部署说明，并新增 `producer/README.md`、`publisher/README.md`、`cloud/README.md` 和 `contracts/README.md`，说明每个运行面的入口、环境变量、包生命周期和故障恢复；文档中只出现 `AIPING_API_KEY`、`AGY_*`、`CLOUD_*` 等变量名，不出现任何密钥值。
8. 新增根目录 `tools/install-project-skills.mjs` 与 `skills/manifest.json`。安装脚本从仓库根执行 `npx skills add <source> --skill <skill> --copy`，每项安装完成后读取实际 `SKILL.md`/仓库 commit，写入根 `skills.lock.json`；任何指定 skill 不存在、来源 commit 无法解析或复制目录不完整时退出非零并停止，不静默安装相近名称。所有 producer/weekly/daily 运行只从根 `.agents/skills/` 读取，Mac publisher 不安装或加载生产 skill。

### 2. 建立内容、批次和时间窗口契约

1. 在 `producer/src/data/types.ts` 扩展 `ContentType` 为 `ai-news`、`world-news`、`github-daily`、`github-weekly`、`own-project-weekly`、`recording`，扩展 `RenderEngine` 保持 `hyperframes | remotion`，扩展 `VideoConfig` 增加 `workflowId`、`runId`、`stream`、`edition`、`cadence`、`sourceRefs`、`mediaManifestPath`、`reviewReportPath`；保留现有 `VideoBlock`、`TimelineManifest` 语义，所有调用者同步迁移。
2. 在 `contracts/package.schema.json` 定义 `PackageManifest`：`schema_version`、`package_id`、`run_id`、`workflow`、`stream`、`edition`、`cadence`、`created_at`、`expires_at`、`producer_commit`、`package_state`、`assets[]`、`targets[]`、`timeline`、`content_refs`、`review`、`signature`。`package_state` 只允许 `READY_FOR_PUBLISH`；`assets[]` 每项必须有包内相对路径、类型、字节数、MIME、宽高/时长（若适用）、SHA-256；`targets[]` 必须显式有平台、账号引用、标题、描述、标签、声明、字幕路径、封面路径和 `publish_policy`，`publish_policy` 为必填 enum `draft_only|publish`，缺省或未知值一律拒绝，不得沿用 Python `TargetSpec` 的 `publish` 默认值。签名覆盖的数值字段只使用 JSON 安全整数或规范化十进制字符串；时长统一用 `duration_ms`/帧数，禁止跨 Node/Python 的浮点数 canonicalization 歧义。
3. 规定批次命名和物理目录：`producer/runs/YYYY-MM-DD/<stream>-<edition>-<slug>/`；AI 日报为 `ai-news-morning`、`ai-news-evening`，世界日报为 `world-news-morning`、`world-news-evening`，GitHub 日更为 `github-daily-<repo-slug>`，周更为 `weekly-github-<slug>` 与 `weekly-own-<slug>`。每个 run 内固定有 `config/`、`audio/`、`timeline/`、`renders/`、`review/`、`package/`，不同 run 不覆盖共享 `today.json`、`out/timeline.json` 或 `public/timeline.json`。
4. 在 `producer/scripts/stage.ts` 将阶段 key 从当前的 `morning/evening/github-<repo>` 扩展为完整 `run_id`，阶段序列固定为 `research -> score -> select(if required) -> script -> media -> voiceover -> timeline -> compose -> render -> review -> package`；状态文件改为 `producer/runs/index.json`，每个阶段记录输入摘要、输出清单、commit、开始/结束时间和错误，原子写临时文件再 rename。`daily-pipeline --date` 必须把同一业务日期传给每个 run，禁止阶段自行读取系统当前日期。
5. 在 `producer/scripts/prepare-audio.ts`、`producer/scripts/gen-srt.ts` 和 `producer/src/data/timeline.ts` 中把 timeline 输入从默认单例改为显式 `--run-dir`/`--config`/`--voiceover-dir`/`--timeline-out`；统一输出 `runs/<run>/timeline/timeline.json` 与 `runs/<run>/timeline/subtitle.srt`。音频缺失、ffprobe 失败或 block/narration 数量不一致时直接失败，不使用静默默认时长继续生成交接包。
6. 新增 `producer/scripts/generate-content.ts`：读取 `scored.json`/人工 selection、抓取或读取已核实的原文快照，按 `stream` 生成 `config/content.json`，每个 block 固定含事实、来源 URL、source snapshot hash、摘要、要点、数字、`narration` 和声明；文本模型通过 `CONTENT_PROVIDER`、`CONTENT_BASE_URL`、`CONTENT_MODEL`、`CONTENT_API_KEY` 注入，provider 失败或无法给每个事实绑定来源时停止，不生成可打包配置。
7. 新增 `producer/scripts/generate-github-config.ts`：读取已确认的 GitHub metadata/README 快照，生成单仓库 `project-spotlight` config 和 narration；必须保留 API snapshot hash、README URL、license、stars/forks/language、created_at、最近活动和每个数字的来源，禁止把两个仓库合并到一个 config。周更自有项目使用显式 `weekly/own-project.json` 输入，字段包括项目链接、品牌素材、卖点和 CTA，缺资料时停止，不用 GitHub 统计填充。

### 3. 拆分四条每日生产线并保留重叠窗口

1. 重构 `producer/scripts/daily-research.ts`：新增必填 `--date YYYY-MM-DD`、`--stream ai-news|world-news` 与 `--edition morning|evening`，输出 `runs/<date>/<run>/research/raw.json`。时间窗口由 `windowFor(date, timezone)` 纯函数计算，使用显式 IANA 时区环境变量 `PRODUCER_TIMEZONE`（默认 `Asia/Shanghai`），禁止用 Windows 主机本地时区或系统当前时间隐式计算；窗口规则固定为 morning=`本地时间前一日 08:00` 到 `当日 08:00`、evening=`当日 06:00` 到 `当日 17:30`，并把 `business_date`、`timezone`、`since`、`until` 写入 raw.json。两个 stream 使用相同窗口但独立输出、独立归档、独立评分，不互相覆盖。保留当前 RSS/Atom、Hacker News、GitHub Search 机制，按 source registry 分流，单源失败可跳过；所有实时源均失败时只能写 `source_unavailable` 并阻止后续 `script/render/package`，归档回顾内容必须显式通过 `--retrospective` 运行、带 `is_retrospective=true`，不进入实时日报交接包。
2. 新增 `producer/config/news-sources.json`，把现有 AI 信源（Hacker News、GitHub Trending、qbitai、36kr、Solidot、雷锋网、钛媒体、TechCrunch、arXiv）和世界信源（BBC World、环球、中新网、BBC Technology）列为可审计 source entry，字段包含 `stream`、`name`、`url`、`parser`、`enabled`、`trust_level`；不得再由脚本硬编码 source URL。海外源不可达时记录失败原因，并通过项目内 `agent-reach` 路由补充只读资料，不能伪造条目。
3. 重构 `producer/scripts/score-and-rank.ts`：增加 `--stream`/`--run-dir`，AI 和世界分别输出 `scored.json`、`top.md`、`selection-candidates.json`，保留当前去重和来源/时效/热度分数；GitHub 候选单独输出 stars、forks、language、license、created_at、README URL、近期开源活动和 5 维候选评分。评分结果必须保留原始 URL 和来源引用。
4. 新增 `producer/scripts/select-github.ts`，读取 GitHub 候选与实时 metadata/README，生成 3 个推荐卡供人工确认；确认输入为 `selection.json`，必须选择 1–2 个仓库并记录 `selected_by`、`selected_at`、仓库 URL 与 API 快照 hash。未确认时不进入脚本生成、渲染或交接包阶段。
5. 为每日 AI 日报和世界日报分别生成配置：`config/type=ai-news/stream=ai-news` 与 `config/type=world-news/stream=world-news`，每场只展示对应 stream 的内容；不再使用当前 `today.json` 中 AI/其他两半场混排的结构。保留每条新闻的摘要、数据卡、要点、来源、URL、旁白要求，世界新闻额外保存原文标题与中文译名及翻译来源。
6. 每日 GitHub 项目介绍改走 HyperFrames：以 `project-spotlight` 的信息密度规则生成一条独立配置；1–2 个项目各自独立 run、独立 timeline、独立审查和独立发布包，不能把两个仓库塞进同一镜头或共享一个可变 `today.json`。
7. 新增 `producer/scripts/daily-pipeline.ts` 作为每日编排入口，接受 `--date`、`--streams ai-news,world-news`、`--editions morning,evening`、`--github-count 1|2`；研究/评分阶段按四个日报 run 并行，GitHub 候选阶段并行，人工确认后各项目 run 再并行。每个并行分支只能写自己的 run 目录，汇总阶段只读各分支清单。

### 4. 实现 HyperFrames 稳定批量生成

1. 把当前 `producer/scripts/gen-hyperframes.ts` 的 `main()` 拆为可导入的 `generateHyperframes(job: HyperframesJob): Promise<HyperframesArtifact>`，参数显式包含 config、timeline、stream、edition、runDir、orientation、style、assetRoot；保留现有 pageKind、theme、音频复制和 BGM ducking 逻辑，但所有输出必须写当前 run 目录。
2. 统一 HyperFrames 组合 ID 为 `hf-<run-id>-short` 与 `hf-<run-id>-long`，防止多个 run 共用当前的 `ai-news` ID；生成器要同时保证 root `data-start=0`、固定宽高、`data-duration`、`data-fps`、单一 paused GSAP timeline、唯一 DOM id 和 framework-owned audio。
3. 新增 `producer/scripts/hyperframes-batch.ts`，读取 `batch.json`，先为每个 job 生成 short/long 组合，再按固定并发上限运行 `npx hyperframes check --strict`，check 全通过后才运行 `npx hyperframes render --quality high`。并发只发生在互不共享 run 目录的 job 之间；单 job 内 short/long 顺序执行，避免 Chromium/FFmpeg 资源争抢。
4. `batch.json` 每项固定包含 `runId`、`configPath`、`timelinePath`、`outputDir`、`orientations`、`quality`、`expectedDurationSec`；批处理器输出机器可读 `batch-result.json`，每项记录 check/render exit code、MP4 路径、字节数、duration、SHA-256 和错误日志路径。任一 job 失败不吞错，整体返回非零但保留其他成功 job。
5. 每个 HyperFrames job 在 render 前自动捕获 `snapshot` 中点和末点；在 render 后运行 `ffprobe` 校验封装时长、分辨率、视频流、音频流，随后调用统一 `review-video` 审查器。`check` 通过不等于成片通过，只有 render review=pass/warning 且没有 high issue 才能打包。
6. 更新 `producer/package.json`：增加 `research:stream`、`select:github`、`pipeline:daily`、`hyperframes:batch`、`package:create`、`review:video`、`remotion:weekly` 命令；删除依赖当前单例 `today.json`/`out/` 的生产命令，但保留测试 fixture 专用脚本入口。

### 5. 实现周更 Remotion 定制链路和媒体生成接口

1. 重构 `producer/src/Root.tsx`、`producer/src/compositions/VidoShort.tsx`、`producer/src/compositions/VidoLong.tsx`：Root 的 `defaultProps` 和 `calculateMetadata` 改为消费序列化 `RenderJobProps`，不再硬编码 `src/data/today.json` 或唯一 `public/timeline.json`；`VidoShort/VidoLong` 从 props 接收 config、timeline、assetRoot 和 voiceoverRoot，保留现有 ProjectSpotlight、BlockRenderer、BGM 和双画幅行为。
2. 重构 `producer/scripts/render-batch.ts` 为数据集渲染器，读取 `weekly/batch.json`，一次 bundle 后对每个 job 复用同一 bundle，分别调用 `selectComposition({id,inputProps})` 与 `renderMedia({inputProps})`；输出路径固定为每个 run 的 `renders/short.mp4`、`renders/long.mp4`。使用 JSON 可序列化 props，禁止把文件句柄、函数或绝对路径传入 Chrome。
3. 新增 `producer/scripts/weekly-pipeline.ts`，固定周六生成/审查、周日进入发布队列；每周生成一个 GitHub 精品 run 和一个自有项目 run。GitHub 精品 run 使用实时 GitHub API/README 事实；自有项目 run 使用用户提供的项目资料、官网/GitHub/文档链接、卖点、品牌资产和 CTA，不得把自有项目数据伪装成 GitHub 统计。
4. 周更每个 run 必须先生成 `video-spec.md`/`storyboard.md`，使用项目内 `video-spec-builder` 与 `video-agency-roles` 产出分镜、镜头时长、信息载荷、素材清单和平台版本，然后由 `motion-design` 映射到 Remotion 组件/GSAP/Three.js/Lottie；`ProjectSpotlight.tsx` 只增加有实际语义差异的新 scene route，不复制现有页面组件。
5. 新增 `producer/media/` 的媒体清单和生成适配层：`media-manifest.json` 记录 prompt、model、provider、尺寸、比例、文件 hash、许可/来源和生成时间；`AIPING_BASE_URL` 默认 `https://aiping.cn/api/v1`，`AIPING_API_KEY` 只从环境读取；默认模型配置为 `Doubao-Seedream-5.0-lite`（图片）与 `Kolors`（图片），`Kling-V2-New` 作为可选视频素材模型。模型名可在 job 中覆盖，但不可写入密钥。
6. 媒体适配层在生成前调用 provider capability/model probe；如果模型不存在、接口不支持当前尺寸或请求失败，run 状态改为 `needs_asset` 并停止渲染，不用占位图、不静默切换模型。外部生成的 PNG/MP4 可以通过 `media-manifest.json` 导入，导入时必须重新计算 SHA-256 并记录来源。
7. Windows 端声音流程保留为权威输入：`producer/scripts/tts-cosyvoice.py` 生成分段 WAV，`prepare-audio.ts` 只探测和校验，`gen-srt.ts` 只从同一 timeline 生成字幕；Mac 包中只消费最终 WAV/SRT/视频，不再执行 TTS。每个 run 的音频文件名按 block index 固定且必须与 config block 数量一致。

### 6. 统一整片理解、审查和交接包

1. 重构 `producer/scripts/review-video.ts` 为 `ReviewProvider` 接口：`AgyReviewProvider` 优先执行锁定版本的 `agy --print` 完整视频理解；`ClaudeVideoWatchProvider` 只调用 `skills.lock.json` 中已安装 `watch` skill 的文档化入口（入口路径由配置解析，禁止猜测不存在的 `watch` CLI），按该 skill 能力使用字幕、场景帧和 Whisper fallback。两个 provider 输出同一内部结果，Windows 下使用跨平台 Node sleep。provider 不可用、返回非零、输出无法解析或证据不完整时只能得到 `status=error`，不得降级为 pass。
2. `review-video` 的报告 schema 固定为 `status`、`verdict`、`issues[]`、`summary`、`model`、`provider`、`reviewed_at`、`video`、`timeline_hash`、`config_hash`；`status` 为 `completed|error`，`verdict` 为 `pass|warning|fail|unknown`。issue 必须有 `timestamp_sec`、`severity`、`location`、`description`、`suggestion`；error 必须有 `provider_error`。render 与 repost 使用各自 schema，所有待打包的 short/long 产物都必须有 completed 报告。
3. 新增 `producer/scripts/create-package.ts`：仅接受 HyperFrames/Remotion check、ffprobe、所有目标视频的完整 review、timeline/config/media manifest hash 全部满足后生成 package；review 必须是 completed 且 verdict 为 pass 或 warning，warning 不得含 high issue。将 short/long MP4、SRT、portrait/landscape cover、平台 metadata、review report、timeline 和所有 asset 复制到 package；每个文件流式 SHA-256，单文件上限 2 GiB，拒绝路径穿越和包外引用。
4. 使用 Windows 生产私钥对 canonical manifest 签名；公钥只部署到 Mac Publisher 和 Cloud Run verifier。签名覆盖 schema version、package id、run id、asset list、hash、target metadata、review hash、producer commit 和固定的 `package_state=READY_FOR_PUBLISH`，防止包内文件或平台文案被替换；Cloud 的索引状态另存，不回写已签名 manifest。
5. 在 `contracts/package.schema.json` 固定签名对象：算法 `Ed25519`，编码 base64url 无填充，canonicalization `JCS`（RFC 8785）。签名输入是移除 `signature.value` 后的完整 manifest 的 UTF-8 JCS 序列化，保留 `algorithm`、`key_id` 和 `canonicalization` 字段；Windows 私钥只保存到 Windows Secret Store，Mac/Cloud 只保存公钥。签名失败、key_id 未知、JCS 不一致或验签失败时拒绝打包/上传/验包。新增 `contracts/vectors/`，提交至少两个脱敏 manifest、其 canonical UTF-8 bytes、签名和预期验签结果；Node producer、Python publisher、Cloud verifier 三方必须用同一向量互验，字段新增/删除、Unicode、整数和时间戳变更均有 negative vector。
6. 每个 package 只能写入 `package_state=READY_FOR_PUBLISH`，不得写入 `AUTHORIZED`。Mac 收包后必须经过 `DRAFT_READY -> DRAFT_VERIFIED -> READY_TO_REVIEW`；只有 operator 通过 dashboard/显式 CLI 提供身份、目标和一次性 TTL nonce，才可进入 `AUTHORIZED -> PUBLISHING`。生产 daemon 不得自动创建、自动批准或自动消费授权。
7. 音频是 Windows producer 的权威输入：默认只允许配置的 CosyVoice endpoint；若显式启用 edge-tts 等替代 provider，必须把 provider、voice、参数和每段 WAV hash 写入 run manifest，并重新通过字幕/时长/整片 review，禁止"服务失败后自动 fallback 但仍视为同一权威音轨"。

### 7. 增加 Cloud Run 控制面、对象存储、Firestore 和自有域名部署

1. 新增 `cloud/control-plane/` Node 22 TypeScript 服务，使用 Firestore 保存 package/job/device/receipt 索引，使用 Cloud Storage 保存包对象；Cloud Run 不保存大文件、不保存 Cookie、不运行浏览器自动化、不运行视频模型。服务提供公开 `/healthz` 与受认证的 `/readyz`，ready 仅在 Firestore、Storage 和公钥配置可用时返回成功。
2. REST API 固定为 `/api/v1/packages` 资源：`POST /api/v1/packages` 注册已验签 manifest 并返回每个 asset 的 resumable/signed upload 信息；`POST /api/v1/packages/:id/complete` 校验所有对象已上传、对象 generation/size/MIME 与 manifest 一致后，原子地将 Cloud 索引置为 `ready`；`GET /api/v1/packages?consumer=mac&state=ready` 查询待取包；`GET /api/v1/packages/:id/manifest` 返回验签 manifest；`GET /api/v1/packages/:id/assets/:asset` 返回短时单对象 signed URL；`POST /api/v1/packages/:id/receipts` 写回 Mac 处理结果。使用 `201/200/400/401/403/404/409/422/429/500/503` 语义状态码和统一 `{data}`/`{error}` envelope；未 complete 的包绝不出现在 `state=ready`。
3. 设备认证使用带 scope、过期时间和撤销状态的随机 opaque token。`cloud/tools/device-token.ts` 负责生成/轮换/撤销 Windows 与 Mac token：服务端只保存 token hash（可加 Secret Manager pepper），明文只在设备 OS Secret Store/环境注入中保存一次，不写日志；每次请求校验 device、scope、expires_at、revoked_at，常量时间比较。轮换立即撤销旧 token；Cloud Storage signed URL 只授权指定对象和单次用途。包内容另用 producer manifest 签名验真。
4. 所有上传文件校验路径不能包含 `..`，必须在允许类型/大小内；complete 阶段还要核对 Cloud Storage 对象 metadata、generation、字节数和 manifest SHA-256。日志只记录 package id、run id、device id、hash 和状态，不记录 token/cookie/签名 URL；receipt 使用 `(package_id, target_id, idempotency_key)` 唯一键实现幂等。
5. 新增 `cloud/Dockerfile`、`.dockerignore`、`cloud/deploy.sh` 或等价 gcloud 配置，固定 Node 22、非 root、最小运行镜像、startup/readiness、Cloud Run 最小/最大实例数和资源上限；配置 `GCP_PROJECT_ID`、`GCP_REGION`、`PACKAGE_BUCKET`、`FIRESTORE_DATABASE`、`DEVICE_TOKEN_PEPPER`、公钥位置等环境变量，不把项目号、域名或密钥写死。
6. 新增 `cloud/infra/` 配置创建 Cloud Run、Cloud Storage 生命周期规则、Firestore、Secret Manager 和日志告警；包对象按 `packages/<date>/<package-id>/` 保存，完成回执后按 retention 清理视频大文件，manifest/receipt 按更长保留期保存。Cloud Storage signed URL 仅用于特定对象的短时上传/下载。
7. 自有域名接入采用 Cloud Run 前的 HTTPS global external Application Load Balancer 路径，按官方文档完成域名验证、证书和 DNS 记录；不把 Cloud Run preview domain mapping 当作生产方案。域名由 `CONTROL_PLANE_DOMAIN` 注入，执行部署前检查 DNS/TLS readiness。
8. 如果执行机没有 gcloud 登录、GCP project、Billing 或域名 DNS 权限，完成全部可验证的本地 API/容器/签名测试，生成可执行部署文件并把唯一阻塞项记录为 deployment prerequisite；不得伪造已部署 URL 或试用额度状态。Google Cloud 新账号的试用额度只作为用户账户侧基础设施预算，不写入运行时逻辑。

### 8. 将根 Publisher 改为 Mac 只发布运行面

1. 在 `publisher/backend/models/contract.py` 增加 `PackageManifest` 校验入口或 Python 等价模型，读取 package 根目录的 manifest；校验 schema version、JCS/Ed25519 签名、公钥、固定 package state、相对路径、文件存在性、MIME、大小、sha256、review status/verdict、target metadata 和 `publish_policy`，任一失败写入拒绝回执并不 claim lease。
2. 扩展 `publisher/backend/transport/local_watch_adapter.py`：扫描 `publisher/data/incoming/<package-id>/`，只处理原子完成标记存在且 manifest 校验成功的包；继续使用 64 KiB 分块 SHA-256，但把当前按 task id 猜目录的逻辑改为 package id/index 绑定，避免同名目录误认。保留 GitHub Release adapter 作为云端下载兼容入口，并新增 Cloud Control Plane adapter 轮询 `/api/v1/packages`、完成断点下载后再进入本地验包。
3. 将 `publisher/backend/daemon/publisher_daemon.py` 的输入从旧 `TaskPackage` 兼容解析切为 `PackageManifest -> TaskPackage` 映射：视频、封面、SRT、metadata 来自 package；Windows 的 `review` 和 `timeline` 作为证据只读保存；Mac 不生成媒体、不调用 AIPING/agy/whisper，不执行 producer 脚本。删除当前按 `publish_policy=publish` 自动签发 `publisher_daemon_auto_policy` 授权的路径。
4. 新增显式 operator authorization service/CLI：只能对已 `DRAFT_VERIFIED` 的指定 target 创建短 TTL、单用途 nonce，记录 operator identity、reason、package/target scope，并在 state machine 中原子消费；operator identity 必须通过 macOS 本地用户身份校验（仅允许配置的 OS 用户组）或明确配置的硬件/签名凭据认证，不能由请求体自报。dashboard 只调用此入口，不能直接传递 `AUTHORIZED` 状态。重复、过期、scope 不符、未认证或重放 nonce 均拒绝并写审计链。
5. 保留并强化现有 `LeaseManager` version fencing、`TargetStateMachine`、`StateReconciler`、三池调度、MacPowerGuard、MediaStorageGC 和 HashChainedAuditLog。将 transport receipt 同时写本地 `receipt.json` 和 Cloud API receipt；回执包含 package id、task id、target state、post id/url、错误码、审计 hash、publisher commit 和时间，并按 Cloud 的幂等键去重。
6. 平台适配器只消费已准备的目标字段：B站、小红书、抖音、快手、视频号、TikTok、X、YouTube 的 upload/mutate/verify/submit/confirm 接口不再负责内容生成；所有现有示例 post id、feed id、video id 和 accepted 成功值必须移出生产适配器，改为真实响应解析或明确 `provider_unavailable` 失败。测试 double 只存在于测试模块。继续在 Mac 管理账号 Cookie/profile、外网平台代理和平台特定字段；`publish_policy=draft_only` 目标停在草稿验证，不签发最终授权。
7. 将 Mac 本地 dashboard 的 registry 扩展为 `package_id`、`run_id`、`stream`、`edition`、`cadence`、`review`、`receipt`、`cloud_status` 字段；dashboard 只能批准/拒绝/查看草稿和回执，批准动作必须调用 operator authorization service，不能绕过 nonce。Mac 白天离线时保留本地队列，回家连上同一路由器后优先拉 Cloud Control Plane，失败再扫描 local watch 目录。
8. 更新 `publisher` 运行文档和 launchd 示例：daemon 开机启动、网络恢复后轮询、任务期间 `caffeinate`、完成/失败/授权过期通知、磁盘 GC、Cloud API 重试采用指数退避并有上限；不得在 Mac 上安装 Node/FFmpeg/模型作为生产前置条件。

### 9. 验证、迁移和交付

1. 先为共享契约、IANA 时区窗口、批次隔离、内容配置生成、GitHub 1–2 个选择、HyperFrames batch 失败隔离、Remotion inputProps、media manifest、provider error 不可过门、JCS/Ed25519 package signature、Cloud upload complete、Mac 包拒绝、显式 authorization、Cloud API 鉴权和 receipt 幂等写单元/集成测试；新测试必须先运行并证明目标行为 RED，再实现 GREEN。保留当前 `publisher/tests` 的 8 项回归测试并迁移 import/路径。
2. Windows producer verification：在 `producer/` 运行 `npm ci`、`npx tsc --noEmit`；用固定 fixture 生成 AI morning、AI evening、world morning、world evening 四个 run，断言窗口带同一显式 timezone 且目录、config、timeline、组合 ID 和输出不覆盖；断言研究选择到 `config`/`narration` 的事实引用完整。用两个 GitHub fixture 选择 1 个和 2 个项目，断言各自生成独立 HyperFrames job 与 project-spotlight config。
3. HyperFrames verification：对至少一个日报 short/long 和一个 GitHub daily job 运行 `npx hyperframes check --strict`、midpoint/end snapshots、`npx hyperframes render --quality draft`；检查 root dimensions/data-start/data-duration、唯一 timeline、无黑帧、实际音频、分辨率和 ffprobe duration；对 short/long 全部运行整片 review。故意破坏一个数字、删除一个 asset、让 provider 输出非 JSON，确认 review/package gate 返回非零且不产生 `READY_FOR_PUBLISH`。
4. Remotion verification：使用两个 weekly fixture 调用一次 bundle、不同 inputProps 渲染两个 run，断言视频内容、时长、音频和输出路径互不串线；运行 `npx tsc --noEmit` 与现有 component tests。每个周更 run 必须检查 `video-spec.md`、媒体清单、品牌/项目链接、来源引用和 CTA。
5. Publisher verification：在 `publisher/` 运行 `python -m pytest -v`；增加签名 manifest 正常包、JCS 字段变更、hash 不匹配、路径穿越、缺字幕、review error/fail、过期 package、重复 receipt、旧 lease version、自动授权回归和 nonce 重放测试；用本地 incoming fixture 跑一次 daemon poll，确认只处理合法包并生成 receipt，确认 `draft_only` 和未授权 `publish` 都不触发 `submit_publish`。
6. Cloud verification：使用 Firestore/Storage emulator 或本地 fake adapter 测试 manifest register、upload complete 前不可见、认证/轮换/撤销、大小/MIME/路径校验、签名验真、对象 generation/hash 校验、signed URL 生成、receipt 幂等、409 冲突、429 rate limit 和 503 upstream failure；容器运行 `/healthz`/`/readyz`，再用 gcloud dry-run/describe 检查 Cloud Run、bucket lifecycle、secret bindings、LB/DNS/TLS 配置。
7. 端到端双机演练：Windows 生成并签名一个日报包，模拟 Mac 白天离线；Windows 上传所有对象并调用 complete，Mac 晚间恢复网络后拉包、校验、进入草稿，operator 明确批准指定 target 后发布并回写 receipt；再模拟下载中断、hash 错、Cloud API 超时、发布后断网，确认断点恢复、UNKNOWN_OUTCOME 调和、重复发布保护和旧 nonce 拒绝。演练使用测试平台 double，不向真实平台发送未确认的外部发布。
8. 最终交付只包含可审计的源代码、锁定的项目级 skills、schema/示例、部署配置、运行手册、测试报告和一个脱敏 fixture package；不提交 `node_modules`、视频大文件、Cookie、OAuth token、AIPING key、signed URL 或真实生产 receipt。

## Critical Files & Anchors

- `vido/scripts/daily-research.ts`：当前 morning/evening 时间窗口、15 源采集、归档回退和 `category=ai|other` 分流；重构为独立 AI/世界 stream 的基础。
- `vido/scripts/gen-hyperframes.ts`：当前页面类型、timeline 转 `data-*`、音频/BGM 复制和 GSAP timeline 生成；拆成可导入生成器并接入批处理。
- `vido/scripts/render-batch.ts`：当前只渲染固定 `VidoShort`/`VidoLong` 且传空 `inputProps`；改为复用 bundle 的 dataset renderer，承载周更 Remotion。
- `vido/src/Root.tsx`：当前默认读取 `src/data/today.json` 和 `public/timeline.json`；改为完全由 `RenderJobProps` 驱动，消除跨 run 串线。
- `backend/models/contract.py` 与 `backend/daemon/publisher_daemon.py`：当前 TaskPackage 与 Mac daemon 生命周期；接入签名 PackageManifest，但保留现有 lease fencing、TTL 授权、调和器、审计链和平台适配器。

## Verification

- 工作目录：producer 侧命令从 `producer/` 执行；publisher 侧命令从 `publisher/` 执行；cloud 侧命令从 `cloud/` 执行。
- Producer 基线：`npm ci`、`npx tsc --noEmit`、每日四 run fixture、GitHub 1/2 项目 fixture、`npx hyperframes check --strict`、snapshot、draft render、`ffprobe`、整片 review、package signature verify。
- Publisher 基线：`python -m pytest -v`；合法/非法 package fixture、hash/signature/path/review/lease/nonce/receipt 场景。
- Cloud 基线：本地 emulator/fake storage + API integration、容器 `/healthz`/`/readyz`、gcloud 配置 dry-run；真实 GCP deploy 只有在认证、project、billing、domain DNS/TLS prerequisites 可用时执行。
- 新行为验收：同一日期生成 AI morning 与 world morning，二者 research/config/timeline/output/package 路径和 composition id 必须不同；同一批次选择两个 GitHub 项目，必须得到两个独立 package；删除任一包资产或修改一个 hash，Mac `fetch_pending_packages()` 必须返回空且生成拒绝原因；提交相同 receipt 两次，Cloud 与 local receipt 必须保持单次状态转移。
- 生产门：只有 `review.verdict` 非 fail、所有 assets hash 通过、producer manifest 签名通过、Mac draft verification 通过且 operator 明确消费一次性 authorization nonce 后，才允许平台 `submit_publish`。

## Assumptions & Contingencies

- 每日 AI/世界日报都按 morning/evening 各一场，沿用当前两个本地时间窗口；窗口可以重叠，但 stream、run、timeline、package 和发布台账始终独立。
- GitHub 日更默认自动筛选后人工确认 1–2 个；未确认时停止在 selection 阶段，不自动选题发布。
- 周更固定周六生成/审查、周日进入发布队列；具体周日发布时间由 package target schedule 字段指定，不在 producer 内硬编码平台时间。
- Windows 是声音、素材生成、HyperFrames/Remotion 渲染和整片审查唯一责任方；若 Windows 缺少 `agy`，按 provider chain 使用项目内 `watch` skill；若两者都不可用，run 失败，不把未审查视频打包。
- AIPING 接口若不支持某个配置模型或当前媒体尺寸，按 `needs_asset` 停止该 weekly run，等待导入合格外部媒体；不静默换模型、不生成占位素材。
- Cloud Run/Storage/Firestore 是公网控制面与中转，不是执行面；若云端部署凭据或域名权限暂不可用，先完成本地控制面和签名/receipt 测试，再保留唯一部署阻塞项，不声称云端已上线。
- 现有 Publisher 的 8 项 Python 测试和现有 5 块 producer fixture 是回归基线；迁移只改路径和契约适配，不删除测试用途。