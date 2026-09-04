import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple, List, Dict

from ..conf import DB_PATH

GENESIS_HASH = "0" * 64

class HashChainedAuditLog:
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
        with self._get_connection_cm() as conn:
            conn.execute("""
            CREATE TABLE IF NOT EXISTS publish_events (
                event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                target_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                event_type TEXT NOT NULL,
                payload JSON NOT NULL,
                prev_event_hash TEXT NOT NULL,
                event_hash TEXT NOT NULL
            );
            """)
            try:
                conn.execute("CREATE INDEX IF NOT EXISTS idx_publish_events_task ON publish_events(task_id);")
            except Exception:
                pass
            conn.commit()

    def record_event(
        self,
        task_id: str,
        target_id: str,
        event_type: str,
        payload: dict
    ) -> str:
        """追加记录事件并生成防篡改 SHA-256 哈希节点 (带事务锁防并发分叉)"""
        now_str = datetime.now(timezone.utc).isoformat()
        payload_str = json.dumps(payload, sort_keys=True, ensure_ascii=False)

        # 使用 IMMEDIATE 事务锁防止并发 SELECT→INSERT 产生同 prev_hash 分叉
        conn = self._get_connection()
        try:
            conn.execute("BEGIN IMMEDIATE;")
            cursor = conn.cursor()
            cursor.execute("SELECT event_hash FROM publish_events ORDER BY event_id DESC LIMIT 1")
            last_row = cursor.fetchone()
            prev_hash = last_row["event_hash"] if last_row else GENESIS_HASH

            raw_data = f"{prev_hash}|{event_type}|{payload_str}|{now_str}"
            event_hash = hashlib.sha256(raw_data.encode("utf-8")).hexdigest()

            cursor.execute("""
                INSERT INTO publish_events (
                    task_id, target_id, timestamp, event_type,
                    payload, prev_event_hash, event_hash
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (task_id, target_id, now_str, event_type, payload_str, prev_hash, event_hash))
            conn.commit()
            return event_hash
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            raise
        finally:
            try:
                conn.close()
            except Exception:
                pass

    def verify_chain_integrity(self) -> Tuple[bool, int, Optional[str]]:
        """
        全量遍历事件链，校验哈希连贯性与防篡改完整性。
        返回: (is_valid, verified_count, error_message)
        """
        with self._get_connection_cm() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM publish_events ORDER BY event_id ASC")
            rows = cursor.fetchall()

            if not rows:
                return True, 0, None

            expected_prev_hash = GENESIS_HASH
            for idx, row in enumerate(rows):
                if row["prev_event_hash"] != expected_prev_hash:
                    return False, idx, f"Event #{row['event_id']} prev_hash broken: expected {expected_prev_hash}, got {row['prev_event_hash']}"

                # 重新计算当前哈希比对
                raw_data = f"{row['prev_event_hash']}|{row['event_type']}|{row['payload']}|{row['timestamp']}"
                calculated_hash = hashlib.sha256(raw_data.encode("utf-8")).hexdigest()

                if calculated_hash != row["event_hash"]:
                    return False, idx, f"Event #{row['event_id']} payload tampered: calculated {calculated_hash}, stored {row['event_hash']}"

                expected_prev_hash = row["event_hash"]

            return True, len(rows), None
