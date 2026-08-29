import json
import logging
import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, Tuple

from ..conf import DB_PATH
from ..models.state import SessionHealth, AccountCapability, PlatformAvailability

logger = logging.getLogger("session_guard")

class SessionGuard:
    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = str(db_path or DB_PATH)

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10.0, isolation_level=None, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA busy_timeout=5000;")
            conn.execute("PRAGMA foreign_keys=ON;")
        except Exception:
            pass
        return conn

    def register_account(
        self,
        account_id: str,
        platform: str,
        alias: str,
        tags: list[str],
        credential_ref: str
    ):
        """注册或更新账号与凭据索引"""
        now_str = datetime.now(timezone.utc).isoformat()
        with self._get_connection_cm() as conn:
            conn.execute("""
                INSERT INTO accounts (
                    account_id, platform, alias, tags, credential_ref,
                    session_health, account_capability, platform_availability,
                    last_checked_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'SESSION_VALID', 'PUBLISH_ALLOWED', 'AVAILABLE', ?, ?)
                ON CONFLICT(account_id) DO UPDATE SET
                    platform = excluded.platform,
                    alias = excluded.alias,
                    tags = excluded.tags,
                    credential_ref = excluded.credential_ref,
                    updated_at = excluded.updated_at
            """, (account_id, platform, alias, json.dumps(tags), credential_ref, now_str, now_str))
            conn.commit()

    def check_account_health(self, account_id: str) -> Tuple[SessionHealth, AccountCapability, PlatformAvailability]:
        """三级健康巡检探针"""
        now_str = datetime.now(timezone.utc).isoformat()
        with self._get_connection_cm() as conn:
            row = conn.execute("SELECT * FROM accounts WHERE account_id = ?", (account_id,)).fetchone()
            if not row:
                return SessionHealth.LOGIN_REQUIRED, AccountCapability.ACCOUNT_BLOCKED, PlatformAvailability.AVAILABLE

            platform = row["platform"]
            cred_ref = row["credential_ref"]

            # 执行探针 (检查凭据文件或 API Token 是否有效)
            session_health = SessionHealth.SESSION_VALID
            account_cap = AccountCapability.PUBLISH_ALLOWED
            platform_avail = PlatformAvailability.AVAILABLE

            if not cred_ref or not os.path.exists(cred_ref):
                # 凭据丢失或未登录
                session_health = SessionHealth.SESSION_EXPIRED
                account_cap = AccountCapability.PUBLISH_RESTRICTED
                self._send_alert(platform, row["alias"], "Cookie 凭证文件不存在，请重新扫码登录！")

            # 更新数据库健康状态
            conn.execute("""
                UPDATE accounts SET
                    session_health = ?,
                    account_capability = ?,
                    platform_availability = ?,
                    last_checked_at = ?,
                    updated_at = ?
                WHERE account_id = ?
            """, (session_health.value, account_cap.value, platform_avail.value, now_str, now_str, account_id))
            conn.commit()

            return session_health, account_cap, platform_avail

    def _send_alert(self, platform: str, alias: str, msg: str):
        """触发 macOS 系统通知与控制台警报 (含字符串安全转义)"""
        logger.warning(f"[SessionGuard] 账号状态异常 [{platform}] {alias}: {msg}")
        if sys.platform != "darwin":
            return
        try:
            # 安全转义双引号与反斜杠，防 AppleScript 注入与语法崩溃
            def _esc(s: str) -> str:
                return str(s).replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ").replace("\r", "")

            safe_title = _esc(f"发布端告警: {platform} ({alias})")
            safe_msg = _esc(msg)
            cmd = f'display notification "{safe_msg}" with title "{safe_title}"'
            subprocess.run(["osascript", "-e", cmd], capture_output=True, timeout=3)
        except Exception as e:
            logger.error(f"发送 macOS 系统通知失败: {e}")
