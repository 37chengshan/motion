# Spec: Lease Version Fencing — 租约版本栅栏

**Domain**: backend/lease
**Status**: enforced (2026-08-27)
**Source**: review-project-audit C2 修复 + Blocker 并发回退

## 原则

所有 `tasks`/`targets` 写操作必须携带 `lease_token + claim_version` 双重 Fencing，防止僵尸 Worker 超时脏写。

## 约束

1. **DB 层**: `tasks.claim_version INTEGER DEFAULT 0`，`UPDATE` 必须 `WHERE task_id=? AND lease_token=? AND claim_version=?`，`rowcount==0` 即 Fencing 失败。
2. **版本递增策略**:
   - `update_task_status` 原子 `SET claim_version = claim_version + 1`（任务级状态变更唯一路径）。
   - `update_target_status` 仅 `SELECT 校验` 不递增 `tasks.claim_version`，避免 `FairResourceScheduler` 并发 `asyncio.gather` 多 target 同时复用同一版本时首个成功后其余被误杀。Target 级如需独立版本，需为 `targets` 表新增 `claim_version` 列（预留）。
   - `renew_lease` 不递增版本，仅延长 `lease_expires_at`。
3. **调度器**: `Scheduler.execute_task_package` 每个 `sm.transition` 必须检查 `ok`，Fencing 失败立即 `return FAILED` 并 `logger.warning`，不得乐观推进 `current_status`。
4. **Task 终态**: 聚合时必须覆盖 `READY_TO_REVIEW/NOT_PUBLISHED/DRAFT_VERIFIED/AUTHORIZATION_EXPIRED`，不得归入 `PROCESSING`。
5. **连接管理**: 所有 DB 访问经 `_get_connection_cm()` (contextmanager 自动 `close`)，并设 `PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; journal_mode=WAL`，防 Windows 文件锁泄漏。

## 验证

- `test_lease_fencing_and_idempotency` 覆盖：原子领取、幂等 `idempotency_key`、Fencing 冲突 `RACE_CONDITION_LOST`。
- 并发测试：同一 task 多 target `gather` 全部成功（`PUBLISHER_AUTO_PUBLISH=1` 时 8 平台 `CONFIRMED`）。
- Windows `pytest` 8/8 通过，`TemporaryDirectory` 无 `PermissionError`。

## 关联代码

- `backend/daemon/lease_manager.py:_get_connection_cm, claim_task, update_task_status, update_target_status`
- `backend/engine/scheduler.py:execute_task_package, _execute_target_pipeline`
- `backend/engine/state_machine.py`

## 演进

如需 Target 级 Fencing，新增 `targets.claim_version` 并将 `update_target_status` 改为 `WHERE target_id=? AND claim_version=?`。
