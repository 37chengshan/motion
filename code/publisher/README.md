# publisher — Mac 发布端（只发布，不生产）

单一职责：**接收已验收签名包 → 草稿/定时发布 → 回执**。Mac 不运行 TTS、FFmpeg、HyperFrames、Remotion 或模型。

## 包生命周期（本地 target 状态）

```
READY_FOR_PUBLISH（包内固定值，不可改写）
  → DRAFT_READY → DRAFT_VERIFIED → READY_TO_REVIEW
  → AUTHORIZED（仅 operator 消费一次性 TTL nonce 后原子进入）
  → PUBLISHING → 回执
```

`draft_only` 目标停在草稿验证，不签发最终授权；生产 daemon 不得自动创建/批准/消费授权。

## 传输

- 本地：`publisher/data/incoming/<package-id>/`，仅处理原子完成标记存在且 manifest 校验成功的包
- 云端：Cloud Control Plane adapter 轮询 `/api/v1/packages?consumer=mac&state=ready`，断点下载后本地验包
- 回执：本地 `receipt.json` + Cloud `POST /api/v1/packages/:id/receipts`（幂等键 `(package_id, target_id, idempotency_key)`）

## 验证

```bash
cd publisher && python -m pytest -v
```

## 运行

```bash
python -m backend.daemon.publisher_daemon --config conf.py
```

launchd 示例：开机启动、网络恢复轮询、任务期 `caffeinate`、完成/失败/授权过期通知、磁盘 GC、Cloud API 指数退避重试。

## 安全

- operator 身份必须经 macOS 本地用户身份（配置用户组）或硬件/签名凭据认证，不接受请求体自报
- 平台适配器不硬编码示例 post id / accepted 值；无真实响应解析则明确 `provider_unavailable` 失败
- 测试 double 只存在于测试模块