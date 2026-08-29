import os
import tempfile
from pathlib import Path
from datetime import datetime, timezone, timedelta

from backend.models.contract import TaskPackage, AssetSpec, TargetSpec
from backend.models.state import TaskStatus, TargetStatus
from backend.models.policy import PublishAuthorization, sanitize_bilibili_title
from backend.daemon.lease_manager import LeaseManager
from backend.audit.hash_chain import HashChainedAuditLog
from backend.engine.state_machine import TargetStateMachine

def test_contract_dedupe_and_bilibili_sanitization():
    pkg = TaskPackage(
        task_id="task-001",
        idempotency_key="idem-001",
        canonical_content={
            "title": "8月26日 AI <script>alert(1)</script> 🚀 测试",
            "description": "最新动态"
        },
        assets=[AssetSpec(asset_id="a1", type="video", filename="vid.mp4", sha256="abc12345")],
        targets=[TargetSpec(target_id="t1", platform="bilibili", account_ref="default")]
    )
    dedupe_key = pkg.calculate_dedupe_key()
    assert dedupe_key is not None and len(dedupe_key) == 64

    # 测试 B 站标题清洗
    clean_title = sanitize_bilibili_title(pkg.canonical_content["title"])
    assert "<script>" not in clean_title
    assert "🚀" not in clean_title # 非 BMP emoji 被剔除
    assert "8月26日 AI" in clean_title
    print("✓ Test 1: 契约去重键计算与 B 站标题安全清洗验证通过")

def test_lease_fencing_and_idempotency():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test_lease.db"
        lease_mgr = LeaseManager(db_path)

        pkg = TaskPackage(
            task_id="task-100",
            idempotency_key="idem-100",
            targets=[TargetSpec(target_id="t-1", platform="douyin", account_ref="acc_1")]
        )

        # 1. 首次领取
        ok, tok1, ver1, reason = lease_mgr.claim_task(pkg, worker_id="worker_A", lease_duration_sec=300)
        assert ok is True
        assert ver1 == 1
        assert "INITIAL_CLAIM" in reason

        # 2. 幂等拦截 (同一 idempotency_key 正在活跃)
        ok2, _, _, reason2 = lease_mgr.claim_task(pkg, worker_id="worker_B", lease_duration_sec=300)
        assert ok2 is False
        assert "DUPLICATE" in reason2

        # 3. Version Fencing 保护 (使用过期的 ver0 或错误 token 尝试更新)
        fake_update = lease_mgr.update_target_status(
            task_id="task-100",
            target_id="t-1",
            status=TargetStatus.UPLOADING,
            lease_token="wrong_token",
            claim_version=ver1
        )
        assert fake_update is False

        # 正确 token 更新
        real_update = lease_mgr.update_target_status(
            task_id="task-100",
            target_id="t-1",
            status=TargetStatus.UPLOADING,
            lease_token=tok1,
            claim_version=ver1
        )
        assert real_update is True
        print("✓ Test 2: 租约原子领取、幂等防重与 Version Fencing 校验通过")

def test_hash_chained_audit_tamper_detection():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test_audit.db"
        audit = HashChainedAuditLog(db_path)

        # 追加 3 个事件
        h1 = audit.record_event("task-1", "t-1", "START", {"status": "started"})
        h2 = audit.record_event("task-1", "t-1", "UPLOAD", {"progress": 100})
        h3 = audit.record_event("task-1", "t-1", "DONE", {"url": "https://bilibili.com"})

        # 验证初始链条完整
        ok, count, err = audit.verify_chain_integrity()
        assert ok is True
        assert count == 3
        assert err is None

        # 模拟中间数据被非法篡改
        with audit._get_connection_cm() as conn:
            conn.execute("UPDATE publish_events SET payload = '{\"tampered\": true}' WHERE event_id = 2")
            conn.commit()

        # 验证防篡改校验器精准报警
        ok_tampered, failed_idx, err_msg = audit.verify_chain_integrity()
        assert ok_tampered is False
        assert "tampered" in err_msg or "broken" in err_msg
        print("✓ Test 3: 哈希链事件溯源与防篡改精准检测验证通过")

def test_safety_gate_authorization():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test_safety.db"
        lease_mgr = LeaseManager(db_path)
        audit = HashChainedAuditLog(db_path)
        sm = TargetStateMachine(lease_mgr, audit)

        pkg = TaskPackage(
            task_id="task-auth",
            idempotency_key="idem-auth",
            targets=[TargetSpec(target_id="t-auth", platform="bilibili", account_ref="default")]
        )
        ok, tok, ver, _ = lease_mgr.claim_task(pkg, worker_id="worker_A")
        assert ok is True

        # 1. 无授权尝试跃迁至 AUTHORIZED -> 触发拦截并转为 READY_TO_REVIEW
        ok_no_auth, resulting_st, _ = sm.transition(
            "task-auth", "t-auth",
            TargetStatus.DRAFT_VERIFIED, TargetStatus.AUTHORIZED,
            tok, ver, auth=None
        )
        assert ok_no_auth is False
        assert resulting_st == TargetStatus.READY_TO_REVIEW

        # 2. 授权过期拦截
        expired_auth = PublishAuthorization(
            authorization_id="auth-exp",
            task_id="task-auth",
            target_id="t-auth",
            authorized_at="2020-01-01T00:00:00Z",
            authorized_by="admin",
            expires_at="2020-01-01T00:15:00Z"
        )
        ok_exp, st_exp, _ = sm.transition(
            "task-auth", "t-auth",
            TargetStatus.DRAFT_VERIFIED, TargetStatus.AUTHORIZED,
            tok, ver, auth=expired_auth
        )
        assert ok_exp is False
        assert st_exp == TargetStatus.AUTHORIZATION_EXPIRED

        # 3. 合法授权通行
        valid_auth = PublishAuthorization(
            authorization_id="auth-valid",
            task_id="task-auth",
            target_id="t-auth",
            authorized_at=datetime.now(timezone.utc).isoformat(),
            authorized_by="admin",
            expires_at=(datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
        )
        ok_val, st_val, _ = sm.transition(
            "task-auth", "t-auth",
            TargetStatus.DRAFT_VERIFIED, TargetStatus.AUTHORIZED,
            tok, ver, auth=valid_auth
        )
        assert ok_val is True
        assert st_val == TargetStatus.AUTHORIZED
        assert valid_auth.is_consumed is True # Nonce 被消费
        print("✓ Test 4: 安全门禁、草稿隔离与授权 TTL 校验通过")


def test_corrupted_asset_rejection_and_stream_sha():
    with tempfile.TemporaryDirectory() as tmpdir:
        incoming = Path(tmpdir)
        task_dir = incoming / "job-corrupted"
        task_dir.mkdir(parents=True, exist_ok=True)

        video_file = task_dir / "vid.mp4"
        video_file.write_bytes(b"CORRUPTED_VIDEO_BYTES")

        manifest_data = {
            "task_id": "job-corrupted",
            "idempotency_key": "idem-corrupted",
            "assets": [
                {
                    "asset_id": "a1",
                    "type": "video",
                    "filename": "vid.mp4",
                    "sha256": "EXPECTED_DIFFERENT_SHA256_HASH_VALUE"
                }
            ],
            "targets": [{"target_id": "t1", "platform": "douyin", "account_ref": "default"}]
        }
        import json
        (task_dir / "manifest.json").write_text(json.dumps(manifest_data), encoding="utf-8")

        from backend.transport.local_watch_adapter import LocalWatchAdapter
        adapter = LocalWatchAdapter(incoming_dir=incoming)
        import asyncio
        pkgs = asyncio.run(adapter.fetch_pending_packages())
        # 损坏包必须被安全跳过，不得进入执行队列
        assert len(pkgs) == 0
        print("✓ Test 8: 损坏资产与哈希不匹配任务包自动拦截安全验证通过")
if __name__ == "__main__":
    test_contract_dedupe_and_bilibili_sanitization()
    test_lease_fencing_and_idempotency()
    test_hash_chained_audit_tamper_detection()
    test_safety_gate_authorization()
    test_corrupted_asset_rejection_and_stream_sha()
