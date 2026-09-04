# Spec: Safety Gate — 发布安全门禁

**Domain**: backend/policy
**Status**: enforced (2026-08-27)
**Source**: review-project-audit C1/C2 修复

## 原则

`DRAFT_READY != AUTHORIZED` 且 `DRAFT_VERIFIED != AUTHORIZED`。

任何 `TargetStatus.AUTHORIZED → PUBLISHING` 跃迁必须持有有效的 `PublishAuthorization`，否则状态机强制回退到 `READY_TO_REVIEW` 并记录 `TARGET_GATE_*` 审计事件。

## 约束

1. **人审默认**: `MasterPublisherDaemon` 默认不自动签发授权。仅当环境变量 `PUBLISHER_AUTO_PUBLISH=1|true|yes` 显式开启时，才允许 `authorized_by="publisher_daemon_auto_policy"` 自签，且必须落库 `publish_authorizations` 并日志 `WARNING`。
2. **TTL + Nonce**: `PublishAuthorization` 必须包含 `expires_at` (ISO-8601, 15min 默认) 与全局唯一 `nonce`。`is_valid()` 必须用 `datetime.fromisoformat` 解析后比较 `aware datetime`，禁止字符串字典序比较。
3. **单次消费**: `consume()` 必须原子化 `UPDATE ... SET is_consumed=1 WHERE nonce=? AND is_consumed=0`，内存 `is_consumed` 与 DB 同步，重启后不可重放。`LeaseManager.consume_authorization()` 为唯一消费入口。
4. **持久化**: 签发即 `INSERT OR IGNORE INTO publish_authorizations`；消费即 `UPDATE is_consumed`。所有授权可通过 `LeaseManager.get_authorization(nonce)` 审计。
5. **失败语义**: 无授权 → `NO_AUTH_PROVIDED`；过期/已消费 → `AUTH_EXPIRED` → `AUTHORIZATION_EXPIRED` 终态，需人工介入。

## 验证

- `test_safety_gate_authorization` 覆盖：无授权拦截、TTL 过期拦截、Nonce 单次消费、重启重放拦截。
- e2e 默认 `success=False` 且 `target IN READY_TO_REVIEW`；`PUBLISHER_AUTO_PUBLISH=1` 时才 `CONFIRMED`。

## 关联代码

- `backend/models/policy.py:PublishAuthorization`
- `backend/engine/state_machine.py:TargetStateMachine.transition`
- `backend/daemon/publisher_daemon.py:_process_single_package`
- `backend/daemon/lease_manager.py:store_authorization/consume_authorization`
