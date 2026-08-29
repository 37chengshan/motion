# Motion — 每日视频生产发布系统（单仓库双运行面）

单仓库、两个运行面 + 一个公网控制面：

| 目录 | 运行面 | 职责 |
|---|---|---|
| `producer/` | Windows 生产端 | 研究选题、文稿、声音、素材、HyperFrames/Remotion 渲染、整片审查、签名交接包 |
| `publisher/` | Mac 发布端 | 只接收已验收发布包、账号会话、草稿/定时发布、回执（不跑 TTS/FFmpeg/渲染/模型） |
| `cloud/` | Cloud Run 控制面 | 公网中转索引（Firestore）+ 对象中转（Cloud Storage），不保存 Cookie、不执行模型 |
| `contracts/` | 共享契约 | PackageManifest JSON Schema、JCS/Ed25519 签名向量，跨机交接唯一权威 |

## 内容线

- 每日两次：AI 新闻日报（morning/evening）、世界新闻日报（morning/evening）— HyperFrames 批量渲染
- 每日：GitHub 项目介绍 1–2 个（人工确认选题）— HyperFrames
- 每周（六生成/日发布）：GitHub 精品项目、自有项目 — Remotion 定制渲染

## 交接包

Windows 只产出 `READY_FOR_PUBLISH` 签名包（Ed25519 + RFC8785 JCS canonical），Mac 收包后必须人工以一次性 TTL nonce 授权才可发布；`CONTENT_*`/`AIPING_*`/`AGY_*` 等密钥一律从环境变量注入，仓库、日志、契约中绝不出现密钥原文。

## 快速开始

完整重构计划见 `docs/dual-runtime-video-pipeline-plan.md`（9 个 section，从目录边界到交付验收）。

```bash
# Windows producer
cd producer && npm ci
node scripts/daily-pipeline.ts --date 2026-08-28 --streams ai-news,world-news --editions morning,evening --github-count 1

# Mac publisher
cd publisher && python -m pytest -v
python -m backend.daemon.publisher_daemon --config conf.py

# Cloud（需要 gcloud 登录与项目权限；不可用时先跑本地 emulator 测试）
cd cloud && npm ci && npm test
```

## 安全基线

- 计划/代码/日志不写入任何密钥原文
- Mac 不运行 TTS、FFmpeg、HyperFrames、Remotion 或模型
- 最终发布只能由 operator 消费一次性 TTL nonce 触发（`draft_only` 目标停在草稿验证）
- 包内每文件 SHA-256 流式校验，单文件 ≤ 2 GiB，路径禁止 `..`

详见各子 README：`producer/README.md`、`publisher/README.md`、`cloud/README.md`、`contracts/README.md`。