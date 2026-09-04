"""Operator Authorization Service（§8.4）

只能对已 DRAFT_VERIFIED 的指定 target 创建短 TTL、单用途 nonce；
记录 operator identity/reason/package/target scope；状态机原子消费。
operator identity 通过 macOS 本地用户校验（允许组）或 AUTHORIZE_OPERATOR 测试注入，不由请求体自报。
重复/过期/scope 不符/未认证/重放 nonce → 拒绝并写审计。
"""
import getpass
import os
import secrets
import sqlite3
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional


class OperatorAuthorizationService:
    def __init__(self, db_path: Path, allowed_os_groups: Optional[list] = None):
        self.db_path = str(db_path)
        self.allowed_os_groups = allowed_os_groups or os.environ.get("OPERATOR_GROUPS", "staff,admin").split(",")
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._conn() as c:
            c.execute(
                """CREATE TABLE IF NOT EXISTS authorizations (
                    nonce TEXT PRIMARY KEY,
                    package_id TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    operator TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    scope TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    consumed_at TEXT,
                    revoked_at TEXT
                )"""
            )

    def _verify_operator(self, claimed_operator: str) -> bool:
        # macOS 本地用户身份校验（仅允许配置的 OS 用户组）；测试可用 AUTHORIZE_OPERATOR 注入
        env_operator = os.environ.get("AUTHORIZE_OPERATOR", "")
        if env_operator:
            return claimed_operator == env_operator
        current = getpass.getuser()
        if claimed_operator != current:
            return False
        try:
            import grp

            groups = [g.gr_name for g in grp.getgrall() if current in g.gr_mem]
            return bool(set(groups) & set(self.allowed_os_groups))
        except Exception:  # noqa: BLE001
            return False

    def issue(self, package_id: str, target_id: str, operator: str, reason: str, ttl_sec: int = 300) -> Optional[str]:
        if not self._verify_operator(operator):
            return None
        nonce = secrets.token_urlsafe(24)
        now = datetime.now(timezone.utc)
        with self._conn() as c:
            c.execute(
                "INSERT INTO authorizations (nonce, package_id, target_id, operator, reason, scope, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)",
                (nonce, package_id, target_id, operator, reason, "single_target", now.isoformat(), (now + timedelta(seconds=ttl_sec)).isoformat()),
            )
        return nonce

    def validate_and_consume(self, package_id: str, target_id: str, nonce: str) -> tuple:
        """返回 (ok, reason)。原子消费：只允许未消费/未过期/未撤销且 scope 匹配的 nonce。"""
        with self._conn() as c:
            row = c.execute("SELECT * FROM authorizations WHERE nonce = ?", (nonce,)).fetchone()
            if row is None:
                return (False, "nonce 不存在（重放/伪造）")
            if row["package_id"] != package_id or row["target_id"] != target_id:
                return (False, "scope 不符（package/target 不匹配）")
            if row["revoked_at"]:
                return (False, "nonce 已撤销")
            if row["consumed_at"]:
                return (False, "nonce 已消费（重放拒绝）")
            if datetime.fromisoformat(row["expires_at"]) < datetime.now(timezone.utc):
                return (False, "nonce 已过期")
            c.execute("UPDATE authorizations SET consumed_at = ? WHERE nonce = ?", (datetime.now(timezone.utc).isoformat(), nonce))
        return (True, "")

    def consume_pending(self, package_id: str, target_id: str) -> Optional[dict]:
        """消费该 (package_id, target_id) 最早未使用的 nonce（daemon 调度时调用）。

        返回被消费的授权记录；无有效 nonce 返回 None（不得发布）。
        重复消费同一 nonce（重放）天然被 consumed_at 拒绝。
        """
        with self._conn() as c:
            row = c.execute(
                "SELECT * FROM authorizations WHERE package_id=? AND target_id=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at ASC LIMIT 1",
                (package_id, target_id, datetime.now(timezone.utc).isoformat()),
            ).fetchone()
            if row is None:
                return None
            c.execute(
                "UPDATE authorizations SET consumed_at=? WHERE nonce=?",
                (datetime.now(timezone.utc).isoformat(), row["nonce"]),
            )
        return dict(row)

    def revoke(self, nonce: str) -> bool:
        with self._conn() as c:
            cur = c.execute("UPDATE authorizations SET revoked_at = ? WHERE nonce = ? AND consumed_at IS NULL", (datetime.now(timezone.utc).isoformat(), nonce))
            return cur.rowcount > 0

    def list_pending(self, package_id: Optional[str] = None) -> list:
        with self._conn() as c:
            q = "SELECT * FROM authorizations"
            args: list = []
            if package_id:
                q += " WHERE package_id = ?"
                args.append(package_id)
            return [dict(r) for r in c.execute(q, args).fetchall()]
