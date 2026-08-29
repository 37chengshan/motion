import json
import sqlite3
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional, Tuple

from ..conf import DB_PATH
from ..models.contract import TaskPackage, TargetSpec
from ..models.state import TaskStatus, TargetStatus

class LeaseManager:
    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = str(db_path or DB_PATH)
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10.0, isolation_level=None, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA busy_timeout=5000;")
            conn.execute("PRAGMA foreign_keys=ON;")
        except Exception:
            pass
        return conn

    def _get_connection_cm(self):
        from contextlib import contextmanager
        @contextmanager
        def _cm():
            conn = self._get_connection()
            try:
                yield conn
            finally:
                try:
                    conn.close()
                except Exception:
                    pass
        return _cm()

    def _init_db(self):
        conn = self._get_connection()
        try:
            conn.executescript("""
            CREATE TABLE IF NOT EXISTS tasks (
                task_id TEXT PRIMARY KEY,
                idempotency_key TEXT UNIQUE NOT NULL,
                dedupe_key TEXT,
                status TEXT NOT NULL,
                producer TEXT,
                priority INTEGER DEFAULT 5,
                claimed_by TEXT,
                lease_token TEXT,
                claim_version INTEGER DEFAULT 0,
                lease_expires_at TEXT,
                raw_package JSON,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS targets (
                target_id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                platform TEXT NOT NULL,
                account_ref TEXT NOT NULL,
                status TEXT NOT NULL,
                overrides JSON,
                schedule_time TEXT,
                publish_policy TEXT,
                publish_url TEXT,
                platform_post_id TEXT,
                receipt_screenshot TEXT,
                error_message TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (task_id) REFERENCES tasks(task_id)
            );

            CREATE TABLE IF NOT EXISTS accounts (
                account_id TEXT PRIMARY KEY,
                platform TEXT NOT NULL,
                alias TEXT NOT NULL,
                tags JSON,
                credential_ref TEXT,
                session_health TEXT DEFAULT 'SESSION_VALID',
                account_capability TEXT DEFAULT 'PUBLISH_ALLOWED',
                platform_availability TEXT DEFAULT 'AVAILABLE',
                last_checked_at TEXT,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS publish_authorizations (
                authorization_id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                target_id TEXT NOT NULL,
                authorized_at TEXT NOT NULL,
                authorized_by TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                scope TEXT NOT NULL,
                nonce TEXT UNIQUE NOT NULL,
                is_consumed INTEGER DEFAULT 0
            );
            """)
            conn.commit()
        finally:
            try:
                conn.close()
            except Exception:
                pass

    def claim_task(
        self,
        package: TaskPackage,
        worker_id: str,
        lease_duration_sec: int = 900
    ) -> Tuple[bool, str, int, str]:
        """
        原子领取或重新领取任务。
        返回: (is_claimed, lease_token, claim_version, reason)
        """
        now = datetime.now(timezone.utc)
        expires_at = (now + timedelta(seconds=lease_duration_sec)).isoformat()
        now_str = now.isoformat()
        new_token = f"tok-{uuid.uuid4().hex}"

        with self._get_connection_cm() as conn:
            cursor = conn.cursor()
            # 1. 检查是否存在该 idempotency_key
            cursor.execute(
                "SELECT task_id, status, lease_token, claim_version, lease_expires_at FROM tasks WHERE idempotency_key = ?",
                (package.idempotency_key,)
            )
            row = cursor.fetchone()

            if not row:
                # 首次插入并领取
                raw_json = json.dumps(package.to_dict(), ensure_ascii=False)
                cursor.execute("""
                    INSERT INTO tasks (
                        task_id, idempotency_key, dedupe_key, status, producer,
                        priority, claimed_by, lease_token, claim_version,
                        lease_expires_at, raw_package, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
                """, (
                    package.task_id, package.idempotency_key, package.dedupe_key,
                    TaskStatus.CLAIMED.value, package.producer, package.priority,
                    worker_id, new_token, expires_at, raw_json, now_str, now_str
                ))

                # 插入 targets
                for target in package.targets:
                    cursor.execute("""
                        INSERT INTO targets (
                            target_id, task_id, platform, account_ref, status,
                            overrides, schedule_time, publish_policy, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        target.target_id, package.task_id, target.platform,
                        target.account_ref, TargetStatus.CLAIMED.value,
                        json.dumps(target.overrides, ensure_ascii=False),
                        target.schedule_time, target.publish_policy, now_str, now_str
                    ))

                conn.commit()
                return True, new_token, 1, "INITIAL_CLAIM"

            # 已存在记录，判断是否可重新领取（失败或租约已过期）
            current_status = row["status"]
            lease_exp = row["lease_expires_at"]
            is_expired = lease_exp and (now_str > lease_exp)
            can_reclaim = (current_status in [TaskStatus.FAILED.value, TaskStatus.RECEIVED.value]) or is_expired

            if not can_reclaim:
                return False, row["lease_token"], row["claim_version"], f"DUPLICATE_ACTIVE_OR_COMPLETED ({current_status})"

            # 执行 Fenced Reclaim
            new_version = row["claim_version"] + 1
            cursor.execute("""
                UPDATE tasks SET
                    status = ?,
                    claimed_by = ?,
                    lease_token = ?,
                    claim_version = ?,
                    lease_expires_at = ?,
                    updated_at = ?
                WHERE task_id = ? AND claim_version = ?
            """, (
                TaskStatus.CLAIMED.value, worker_id, new_token, new_version,
                expires_at, now_str, row["task_id"], row["claim_version"]
            ))

            if cursor.rowcount > 0:
                conn.commit()
                return True, new_token, new_version, "RECLAIM_EXPIRED_OR_FAILED"
            else:
                return False, "", 0, "RACE_CONDITION_LOST"

    def renew_lease(self, task_id: str, lease_token: str, claim_version: int, extend_sec: int = 900) -> bool:
        """带 Version Fencing 保护的租约续期"""
        now = datetime.now(timezone.utc)
        expires_at = (now + timedelta(seconds=extend_sec)).isoformat()
        with self._get_connection_cm() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE tasks SET
                    lease_expires_at = ?,
                    updated_at = ?
                WHERE task_id = ? AND lease_token = ? AND claim_version = ?
            """, (expires_at, now.isoformat(), task_id, lease_token, claim_version))
            conn.commit()
            return cursor.rowcount > 0

    def update_task_status(
        self,
        task_id: str,
        status: TaskStatus,
        lease_token: str,
        claim_version: int
    ) -> bool:
        """带 Version Fencing 的任务状态更新 (原子递增 claim_version)"""
        now_str = datetime.now(timezone.utc).isoformat()
        with self._get_connection_cm() as conn:
            cursor = conn.cursor()
            # 原子递增 claim_version 防止僵尸 Worker 脏写
            cursor.execute("""
                UPDATE tasks SET
                    status = ?,
                    claim_version = claim_version + 1,
                    updated_at = ?
                WHERE task_id = ? AND lease_token = ? AND claim_version = ?
            """, (status.value, now_str, task_id, lease_token, claim_version))
            conn.commit()
            return cursor.rowcount > 0

    def store_authorization(self, auth) -> bool:
        """持久化 PublishAuthorization 防重启重放"""
        try:
            with self._get_connection_cm() as conn:
                conn.execute("""
                    INSERT OR IGNORE INTO publish_authorizations
                    (authorization_id, task_id, target_id, authorized_at, authorized_by, expires_at, scope, nonce, is_consumed)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
                """, (auth.authorization_id, auth.task_id, auth.target_id, auth.authorized_at, auth.authorized_by, auth.expires_at, auth.scope, auth.nonce))
                conn.commit()
                return True
        except Exception:
            return False

    def consume_authorization(self, nonce: str) -> bool:
        """原子消费 Nonce，防重放 (返回是否成功消费)"""
        with self._get_connection_cm() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE publish_authorizations SET is_consumed=1 WHERE nonce=? AND is_consumed=0", (nonce,))
            conn.commit()
            return cursor.rowcount > 0

    def get_authorization(self, nonce: str):
        """查询授权记录"""
        with self._get_connection_cm() as conn:
            row = conn.execute("SELECT * FROM publish_authorizations WHERE nonce=?", (nonce,)).fetchone()
            return dict(row) if row else None

    def update_target_status(
        self,
        task_id: str,
        target_id: str,
        status: TargetStatus,
        lease_token: str,
        claim_version: int,
        publish_url: str = "",
        platform_post_id: str = "",
        receipt_screenshot: str = "",
        error_message: str = ""
    ) -> bool:
        """带 Version Fencing 的目标平台子任务状态更新 (SELECT 校验避免并发误伤)"""
        # 说明: Task 级 claim_version 不在 target 路径递增，避免 FairResourceScheduler 并发多 target 时首个成功后其余 Fencing 失败
        # 真正的版本递增仅在 task 级状态变更 (update_task_status) 时进行；此处仅做租约有效性校验
        with self._get_connection_cm() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT 1 FROM tasks WHERE task_id = ? AND lease_token = ? AND claim_version = ?",
                (task_id, lease_token, claim_version)
            )
            if not cursor.fetchone():
                return False
            now_str = datetime.now(timezone.utc).isoformat()
            cursor.execute("""
                UPDATE targets SET
                    status = ?,
                    publish_url = CASE WHEN ? != '' THEN ? ELSE publish_url END,
                    platform_post_id = CASE WHEN ? != '' THEN ? ELSE platform_post_id END,
                    receipt_screenshot = CASE WHEN ? != '' THEN ? ELSE receipt_screenshot END,
                    error_message = CASE WHEN ? != '' THEN ? ELSE error_message END,
                    updated_at = ?
                WHERE target_id = ? AND task_id = ?
            """, (
                status.value,
                publish_url, publish_url,
                platform_post_id, platform_post_id,
                receipt_screenshot, receipt_screenshot,
                error_message, error_message,
                now_str, target_id, task_id
            ))
            conn.commit()
            return cursor.rowcount > 0
