# producer — Windows 内容生产端

单一职责：**内容生产与成片验收**。产出已签名交接包，交给 Mac 发布。

## 生产内容线

| run_id 模式 | 引擎 | 节奏 |
|---|---|---|
| `ai-news-morning` / `ai-news-evening` | HyperFrames | 每日 |
| `world-news-morning` / `world-news-evening` | HyperFrames | 每日 |
| `github-daily-<repo-slug>`（1–2 个/日，人工确认） | HyperFrames（project-spotlight） | 每日 |
| `weekly-github-<slug>` / `weekly-own-<slug>` | Remotion | 周六生成、周日入队 |

## 目录契约

```
producer/
  runs/<YYYY-MM-DD>/<stream>-<edition>-<slug>/
    config/  audio/  timeline/  renders/  review/  package/
```

阶段：`research -> score -> select(if required) -> script -> media -> voiceover -> timeline -> compose -> render -> review -> package`；状态在 `runs/index.json`，原子写。`--date` 必须贯穿所有阶段，禁止阶段自取系统日期。

## 环境变量（只从环境读取，绝不提交）

- `PRODUCER_TIMEZONE`（默认 `Asia/Shanghai`）— 时间窗口用显式 IANA 时区
- `CONTENT_PROVIDER` / `CONTENT_BASE_URL` / `CONTENT_MODEL` / `CONTENT_API_KEY` — 文稿生成
- `AIPING_BASE_URL`（默认 `https://aiping.cn/api/v1`）/ `AIPING_API_KEY` — 媒体生成（Doubao-Seedream-5.0-lite / Kolors 图；Kling-V2-New 可选视频）
- `AGY_*` — 整片审查 provider

## 内容配置生成（§2.6 / §2.7）

- 日报 config：`npm run content:generate -- --run-dir runs/<date>/<stream>-<edition> --date YYYY-MM-DD --stream ai-news|world-news --edition morning|evening [--selection ...]`
  - 读取 `research/scored.json`（可被人工 selection 覆盖），固定每条原文快照（sha256 绑定）后调用文本模型生成 `config/content.json`；
  - 每个 content block 必须携带 facts / url / sourceSnapshotHash / summary / points / stats|highlight / narration / disclaimer；
    provider 失败或任一事实绑定不上来源 → 退出非零，不写 config（无包可打）；
  - 快照优先读 `research/snapshots/<id>.txt`，缺失时加 `--fetch-snapshots` 在线抓取。模型走 `CONTENT_*` 环境变量（fixture 模式：`CONTENT_PROVIDER=fixture GENERATE_FIXTURE=<文件>`）。
- GitHub 日更 / 周更 config：`npm run github:config -- --run-dir runs/<date>/github-daily-<slug> --kind github-daily|github-weekly --date ... --selection ...`
  - 一个 run 只允许一个仓库（1–2 个选择由调用方拆成独立 run）；保留 API/README 快照 hash、license、stars/forks/language、created_at、最近活动，每个数字(stats)都带 sourceUrl + sourceSnapshotHash；
  - 周更自有项目：`--kind own-project-weekly --own-project weekly/own-project.json`（项目链接/品牌素材/卖点/CTA），缺资料即停止，不用 GitHub 统计填充。

## HyperFrames 批量渲染（§4）

- 生成器：`node scripts/gen-hyperframes.ts --run-dir <run> --orientation short|long`（可导入 `generateHyperframes(job)`）；
  组合 ID 固定 `hf-<run-id>-short|long`，root 带 `data-start="0"`/固定宽高/`data-duration`/`data-fps`，单一 paused GSAP 时间轴，DOM id 全局唯一。
- 批处理：`npm run hyperframes:batch -- --batch runs/<date>/batch.json [--concurrency 2] [--review]`
  - batch 项：`{runId, configPath, timelinePath, outputDir, orientations, quality, expectedDurationSec}`；
  - 每组合：generate → `hyperframes check --strict` → 中点/末点 snapshot → `render --quality` → ffprobe（时长/分辨率/流）→ 可选整片 review；
  - 产物 `batch-result.json` 记录每项 exit code/MP4 路径/字节数/duration/SHA-256/错误日志；任一失败不吞错、保留其他成功产物、整体退出非零；
  - 真实 CLI：本机 `hyperframes` v0.8.10（或 `HYPERFRAMES_CLI` 覆盖）；**实测 check 失败时退出码仍为 0**，批处理以 "Check failed" 输出标记把关；子进程 stdin 接 /dev/null 防交互提示阻塞。
- 离线验证：`HYPERFRAMES_CLI=<stub>` 覆盖 CLI；`HYPERFRAMES_RENDER_DURATION_SEC` 供 stub 生成等长片。
- check 通过 ≠ 成片通过：只有 render review=pass/warning 且无 high issue 才可打包（create-package 门）。

## 周更 Remotion 链路与媒体接口（§5）

- 数据契约：`src/data/renderJob.ts` 的 `RenderJobProps`（config/timeline/voiceoverRoot/runId，全 JSON 可序列化）；
  `Root.tsx` 不再读 `today.json`/`public/timeline.json`，duration/fps 完全由 props.timeline 决定。
- 数据集渲染：`npm run remotion:weekly -- --batch weekly/batch.json`（`render-batch.ts`：一次 bundle、逐 job 复用，
  输出 `runs/<run>/renders/short.mp4|long.mp4`；音频复制到 `public/voiceover/<runId>/`）。离线验证用导出 `prepareRenderJobs`。
- 周更编排：`npm run pipeline:weekly -- --date YYYY-MM-DD --github-url <repo> --own-project weekly/own-project.json [--force]`
  （周六生成/审查、周日入队 `weekly-queue.json`；每 run 生成 `video-spec.md`/`storyboard.md` 分镜种子）。
- 媒体：`npm run media:probe|generate|import`（`media-adapter.ts`，清单 `media/media-manifest.json`）。
  `AIPING_BASE_URL` 默认 `https://aiping.cn/api/v1`，`AIPING_API_KEY` 只从环境读；默认模型 Doubao-Seedream-5.0-lite/Kolors（图）、Kling-V2-New（视频）。
  生成前必 probe：模型缺失/尺寸不支持/请求失败 → `needs_asset` 停止渲染，不用占位图、不静默换模型；外部素材 import 重算 SHA-256。
- 离线测试：`AIPING_FIXTURE=<{models,sample}>` 注入 probe/generate。

## 审查与交接包（§6）

- 审查：`npm run review:video -- <视频> [--kind render|repost] [--provider agy|watch|all] [--out report.json]`
  - `ReviewProvider` 接口：agy（`agy --print` 完整视频理解）优先；watch 只调 skills.lock.json 中已安装 watch skill 的文档化入口（`WATCH_CLI` 或可执行 entry_path），禁止猜 CLI；
  - 报告 schema 固定：`status`(completed|error)/`verdict`(pass|warning|fail|unknown)/`issues[]`(timestamp_sec/severity/location/description/suggestion)/`summary`/`model`/`provider`/`reviewed_at`/`video`/`timeline_hash`/`config_hash`，error 必须带 `provider_error`；
  - 门：provider 不可用/非零/无法解析/证据不完整 → `status=error`，绝不降级为 pass。
- 交接包：`npm run package:create -- --run-dir <run> --key <private.pem> --key-id <id> [--targets ...]`
  - 硬门：视频存在+ffprobe、batch-result 无失败 job、每个视频 completed 审查且 verdict∈{pass,warning}（warning 无 high issue）、timeline/config 存在、`publish_policy` 必填 enum；
  - 组装 package/（MP4/SRT/封面/审查报告/timeline/assets），流式 SHA-256、单文件 ≤2GiB、拒绝路径穿越；
  - 签名：Ed25519 + JCS(RFC8785)，`package_state` 固定 `READY_FOR_PUBLISH`（拒绝 AUTHORIZED）；三端向量见 `contracts/vectors`（`tools/generate-contract-vectors.mjs` 再生）。

## 关键门

- 实时源全失败 → `source_unavailable`，停止；回顾内容必须 `--retrospective` 显式运行
- review 必须 `completed` 且 `verdict ∈ {pass, warning}`、无 high issue 才可打包
- `create-package.ts` 全部门后产出 Ed25519+JCS 签名 manifest；私钥只在 Windows Secret Store

## 每日编排

`npm run pipeline:daily -- --date YYYY-MM-DD [--streams ai-news,world-news] [--editions morning,evening] [--github-count 1|2] [--github-selection ...] [--content]`

- 四场日报 research/score 并行（独立 run 目录、独立归档），GitHub 候选并行；
- 选题停在 select 阶段等待人工确认（`runs/<date>/github/research/recommendations.md`），确认后每个仓库独立 run（`github-daily-<slug>`）→ `generate-github-config`；
- 离线验证：`RESEARCH_FIXTURE=<items.json>` 注入固定条目；实时源全失败写 `source_unavailable` 并阻止后续阶段。

## 验证

```bash
npm ci && npx tsc --noEmit
```

## 安全

不提交 Cookie/OAuth token/AIPING key/signed URL/大视频；`.qoder/skills/` 仅作旧 fixture。