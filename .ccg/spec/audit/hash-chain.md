# Spec: Hash-Chained Audit Log — 哈希防篡改审计链

**Domain**: audit
**Status**: enforced (2026-08-27)
**Source**: review-project-audit C3/C4 修复

## 原则

每步状态跃迁均追加 `event_hash = SHA256(prev_hash|event_type|payload|timestamp)`，形成全局防篡改链，启动与巡检时全量验链。

## 约束

1. **并发安全**: `record_event` 必须 `BEGIN IMMEDIATE` 事务内 `SELECT MAX(event_hash)` 后 `INSERT`，防三池并发 (`upload=3, verify=2`) 产生同 `prev_hash` 分叉。`conn` 必须显式 `close`，经 `_get_connection_cm()` 管理。
2. **连接**: `PRAGMA journal_mode=WAL; busy_timeout=5000; foreign_keys=ON`，`isolation_level=None` 显式事务控制，`check_same_thread=False` 允许多线程。
3. **索引**: `CREATE INDEX idx_publish_events_task ON publish_events(task_id)`，避免全表扫描。
4. **验链**: `verify_chain_integrity` 全量遍历 `ORDER BY event_id ASC`，校验 `prev_hash` 连续性与 `payload` 重算一致性；热路径 (`poll_and_process_once`) 仅在启动时全量校验，运行时可抽样或后台线程校验，避免阻塞事件循环。
5. **Genesis**: 空链返回 `(True,0,None)`；首事件 `prev_hash = "0"*64`。
6. **篡改检测**: 任意 `payload` 篡改或 `prev_hash` 断裂即返回 `(False, idx, msg)` 并 `logger.critical` 暂停调度。

## 验证

- `test_hash_chained_audit_tamper_detection` 覆盖：3 事件追加、篡改 `event_id=2` payload、精准报警。
- `test_full_e2e_publishing_pipeline` 覆盖：88+ 事件全链校验 `chain_ok`。
- 并发压测：多任务并发 `record_event` 无分叉，`verify` 始终 `True`。

## 关联代码

- `backend/audit/hash_chain.py:record_event, verify_chain_integrity, _get_connection_cm`
- `backend/daemon/publisher_daemon.py:poll_and_process_once` (启动验链)
- `backend/engine/state_machine.py:_record_transition` (Gate 失败也落审计)

## 演进

如事件量 >10k，考虑按 `task_id` 分片链 + 定期归档，或引入 `global_checkpoint` 表做增量校验。
