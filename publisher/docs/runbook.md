# Mac Publisher 运行手册（§8.8）

## 职责边界

- Mac 只做：接收已验收发布包 → 本地验包（JCS/Ed25519 + 文件 hash）→ 草稿/定时发布 → 回执；
- Mac 不运行：TTS、FFmpeg、HyperFrames、Remotion、文本/视频模型、producer 脚本；
- 前置依赖：仅 Python 3.9+ 与项目依赖（pytest/httpx 等）。**不安装 Node/FFmpeg/模型**。

## 传输通道（优先级）

1. Cloud Control Plane（`CONTROL_PLANE_URL=https://citygenius.top` + `MAC_DEVICE_TOKEN`=~/.dsh/secret/mac-device-token.txt，已实测 readyz 200）：白天离线、晚间联网后优先拉取
   `GET /api/v1/packages?consumer=mac&state=ready` → 下载 → 验包 → 回执（幂等键）；
2. 本地 watch（`data/incoming/<package-id>/`）：仅处理带 `.transfer-complete` 标记且验签通过的包；
   Cloud 失败自动回退本地扫描。
3. GitHub Release（兼容入口，需 `--github-repo`）。

## 授权（人工发布门）

- 草稿验收后停在 `READY_TO_REVIEW`；operator 在 dashboard/CLI 明确批准指定 target：
  `python -m backend.cli.authorize issue --package <id> --target <platform>:<account> --operator $(whoami) --reason "..."`
- 一次性 nonce（TTL 默认 300s）由 daemon 原子消费；重复/过期/scope 不符/重放全部拒绝并记审计；
- `draft_only` 目标永远停在草稿，不签发最终授权。

## 故障恢复

- 网络恢复：daemon 轮询 + Cloud 指数退避（1s→2s→4s…上限 60s）；
- 断点续传：Cloud asset 已存在且 hash 一致则跳过重下；
- 发布中断：StateReconciler 对账 → CONFIRMED / NOT_PUBLISHED / BLOCKED（防止重复发布）；
- 任务期间 `caffeinate`（MacPowerGuard 阻止休眠）；磁盘 GC 保留 3 天。

## launchd

`cp launchd/com.motion.publisher.daemon.plist.example ~/Library/LaunchAgents/`（替换 USER/域名/token），
`launchctl load ~/Library/LaunchAgents/com.motion.publisher.daemon.plist`。
