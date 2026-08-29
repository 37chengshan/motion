import os
import tempfile
from pathlib import Path

from backend.daemon.authorization import OperatorAuthorizationService


def _svc(tmp):
    return OperatorAuthorizationService(Path(tmp) / "auth.db")


def test_issue_consume_and_replay_rejected(tmp_path):
    os.environ["AUTHORIZE_OPERATOR"] = "op-1"
    svc = _svc(tmp_path)
    nonce = svc.issue("pkg-1", "bilibili:default", "op-1", "reviewed", 300)
    assert nonce is not None
    ok, reason = svc.validate_and_consume("pkg-1", "bilibili:default", nonce)
    assert ok and reason == ""
    ok2, reason2 = svc.validate_and_consume("pkg-1", "bilibili:default", nonce)
    assert not ok2 and "已消费" in reason2  # 重放拒绝
    del os.environ["AUTHORIZE_OPERATOR"]


def test_scope_mismatch_rejected(tmp_path):
    os.environ["AUTHORIZE_OPERATOR"] = "op-2"
    svc = _svc(tmp_path)
    nonce = svc.issue("pkg-1", "bilibili:default", "op-2", "r", 300)
    ok, reason = svc.validate_and_consume("pkg-2", "bilibili:default", nonce)
    assert not ok and "scope 不符" in reason
    del os.environ["AUTHORIZE_OPERATOR"]


def test_expired_rejected(tmp_path):
    os.environ["AUTHORIZE_OPERATOR"] = "op-3"
    svc = _svc(tmp_path)
    nonce = svc.issue("pkg-1", "x:default", "op-3", "r", -10)  # 立即过期
    assert nonce is not None
    ok, reason = svc.validate_and_consume("pkg-1", "x:default", nonce)
    assert not ok and "过期" in reason
    del os.environ["AUTHORIZE_OPERATOR"]


def test_revoke_blocks_consumption(tmp_path):
    os.environ["AUTHORIZE_OPERATOR"] = "op-4"
    svc = _svc(tmp_path)
    nonce = svc.issue("pkg-1", "douyin:default", "op-4", "r", 300)
    assert svc.revoke(nonce)
    ok, reason = svc.validate_and_consume("pkg-1", "douyin:default", nonce)
    assert not ok and "撤销" in reason
    del os.environ["AUTHORIZE_OPERATOR"]


def test_operator_gate_without_injection(tmp_path):
    # 无 AUTHORIZE_OPERATOR 且 getpass 用户与声明不符 → 拒绝
    os.environ.pop("AUTHORIZE_OPERATOR", None)
    svc = _svc(tmp_path)
    nonce = svc.issue("pkg-1", "bilibili:default", "definitely-not-current-user", "r", 300)
    assert nonce is None


def test_consume_pending_daemon_path(tmp_path):
    os.environ["AUTHORIZE_OPERATOR"] = "op-5"
    svc = _svc(tmp_path)
    svc.issue("pkg-1", "bilibili:acc", "op-5", "r", 300)
    rec = svc.consume_pending("pkg-1", "bilibili:acc")
    assert rec and rec["operator"] == "op-5"
    assert svc.consume_pending("pkg-1", "bilibili:acc") is None  # 已消费
    del os.environ["AUTHORIZE_OPERATOR"]
