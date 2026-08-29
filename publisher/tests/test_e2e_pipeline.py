import asyncio
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from backend.models.contract import TaskPackage, TargetSpec
from backend.models.state import TaskStatus, TargetStatus
from backend.models.evidence import DraftVerificationRecord, PublishConfirmationRecord
from backend.daemon.publisher_daemon import MasterPublisherDaemon
from backend.transport.local_watch_adapter import LocalWatchAdapter
from backend.contracts.ed25519 import public_key_from_secret, sign
from backend.contracts.jcs import canonical_for_signing
from backend.contracts.package_manifest import validate_package_manifest

TEST_SEED = b"pytest-e2e-publisher-key-v1"
PUB_RAW = public_key_from_secret(TEST_SEED)


class FakePlatformAdapter:
    """测试 double（§8.6：只存在于测试模块）：真实响应解析模拟，不伪造生产 ID"""

    def __init__(self, name: str):
        self.name = name
        self.submit_called = 0
        self.descriptor = type("D", (), {"providers": {"upload": "api"}})()

    async def preflight(self, account_ref: str):
        return True, "ok"

    async def upload(self, video_path: str, target: TargetSpec):
        return {"success": True}

    async def mutate(self, package: TaskPackage, target: TargetSpec):
        return {"success": True}

    async def verify_draft(self, package: TaskPackage, target: TargetSpec):
        return DraftVerificationRecord(
            task_id=package.task_id, target_id=target.target_id, platform=target.platform,
            account_id=target.account_ref, video_uploaded_100=True, title_verified=True,
            desc_verified=True, tags_verified=True, cover_verified=True,
            declaration_verified=True, submit_button_ready=True,
            verified_at=datetime.now(timezone.utc).isoformat(),
        )

    async def submit_publish(self, target: TargetSpec):
        self.submit_called += 1
        return {"accepted": True, "platform_post_id": f"real-{self.name}-{self.submit_called}"}

    async def confirm_published(self, target: TargetSpec, submit_receipt: dict):
        post_id = submit_receipt.get("platform_post_id", "")
        return PublishConfirmationRecord(
            task_id="", target_id=target.target_id, platform=self.name, account_id=target.account_ref,
            status=TargetStatus.CONFIRMED.value, platform_post_id=post_id,
            publish_url=f"https://platform.example/{post_id}",
            server_confirmed_at=datetime.now(timezone.utc).isoformat(),
        )

    async def reconcile_submission(self, account_ref: str, expected_title: str):
        return {"found": True, "post_id": "real-unknown", "publish_url": "https://platform.example/real-unknown"}


def build_signed_manifest(package_id: str, targets: list) -> dict:
    video_bytes = b"FAKE_VIDEO_CONTENT_DATA_STREAM"
    import hashlib
    sha = hashlib.sha256(video_bytes).hexdigest()
    m = {
        "schema_version": 1,
        "package_id": package_id,
        "run_id": "ai-news-morning-2026-08-28",
        "workflow": "hyperframes",
        "stream": "ai-news",
        "edition": "morning",
        "cadence": "daily",
        "created_at": "2026-08-28T00:30:00Z",
        "expires_at": "2026-08-30T00:30:00Z",
        "producer_commit": "0000000000000000000000000000000000000000",
        "package_state": "READY_FOR_PUBLISH",
        "assets": [
            {"path": "renders/short.mp4", "type": "video", "size_bytes": len(video_bytes), "mime": "video/mp4", "width": 1080, "height": 1920, "duration_ms": 30000, "sha256": sha},
        ],
        "targets": targets,
        "timeline": {"path": "timeline/timeline.json", "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "block_count": 8},
        "content_refs": {"source_snapshots": []},
        "review": {"status": "completed", "verdict": "pass", "reports": []},
    }
    canon = canonical_for_signing(m, "test-key")
    m["signature"] = {
        "algorithm": "Ed25519",
        "key_id": "test-key",
        "canonicalization": "JCS",
        "value": __import__("base64").urlsafe_b64encode(sign(TEST_SEED, canon)).rstrip(b"=").decode(),
    }
    return m


def test_full_e2e_publishing_pipeline_with_operator_auth():
    os.environ["AUTHORIZE_OPERATOR"] = "test-operator"
    async def _run():
        with tempfile.TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            incoming_dir = base_dir / "incoming"
            incoming_dir.mkdir(parents=True, exist_ok=True)
            db_path = base_dir / "e2e_publisher.db"

            targets = [
                {"platform": "bilibili", "account_ref": "default", "title": "日报", "description": "d", "tags": ["AI"], "statement": "声明", "subtitle_path": "timeline/subtitle.srt", "cover_path": "covers/cover.png", "publish_policy": "publish"},
                {"platform": "x", "account_ref": "default", "title": "Daily", "description": "d", "tags": ["AI"], "statement": "stmt", "subtitle_path": "timeline/subtitle.srt", "cover_path": "covers/cover.png", "publish_policy": "publish"},
                {"platform": "douyin", "account_ref": "default", "title": "日报", "description": "d", "tags": ["AI"], "statement": "声明", "subtitle_path": "timeline/subtitle.srt", "cover_path": "covers/cover.png", "publish_policy": "draft_only"},
            ]
            manifest = build_signed_manifest("pkg-e2e-001", targets)

            task_dir = incoming_dir / "pkg-e2e-001"
            (task_dir / "renders").mkdir(parents=True)
            (task_dir / "timeline").mkdir(parents=True)
            (task_dir / "renders" / "short.mp4").write_bytes(b"FAKE_VIDEO_CONTENT_DATA_STREAM")
            (task_dir / "timeline" / "subtitle.srt").write_text("1\n00:00:00,000 --> 00:00:02,000\ntest\n")
            (task_dir / "timeline" / "timeline.json").write_text(json.dumps({"fps": 30, "totalFrames": 60, "entries": []}))
            (task_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
            (task_dir / ".transfer-complete").write_text("done")

            # 预校验应通过
            pub_pem = "-----BEGIN PUBLIC KEY-----\n" + __import__("base64").b64encode(PUB_RAW).decode() + "\n-----END PUBLIC KEY-----"
            # validate 需要 SPKI PEM；直接用 raw 字节自建简易校验（验签函数内部仅取末 32 字节，故用 SPKI DER 前缀）
            spki_der = bytes.fromhex("302a300506032b6570032100") + PUB_RAW
            pub_pem_spki = "-----BEGIN PUBLIC KEY-----\n" + __import__("base64").b64encode(spki_der).decode() + "\n-----END PUBLIC KEY-----"

            daemon = MasterPublisherDaemon(
                worker_id="test_mac_worker_01",
                db_path=db_path,
                public_key_pem=pub_pem_spki,
            )
            daemon.transports = [LocalWatchAdapter(incoming_dir=incoming_dir, public_key_pem=pub_pem_spki)]
            # 测试 double 平台适配器
            fake_adapters = {
                "bilibili": FakePlatformAdapter("bilibili"),
                "x": FakePlatformAdapter("x"),
                "douyin": FakePlatformAdapter("douyin"),
            }
            daemon.platform_adapters = fake_adapters

            # ① 无 operator 授权 → 发布目标不得 submit（自动授权回归）
            processed = await daemon.poll_and_process_once()
            assert processed == 1
            for name, a in fake_adapters.items():
                assert a.submit_called == 0, f"{name} 不应在无授权时被提交"
            # ② operator 授权 bilibili 与 douyin（draft_only 也需要停在草稿，不签发最终授权）
            #    注意：authorize 在 db_path 上；重新处理需先移除完成包或重置
            #    直接构造新包路径重新测试授权后行为
            auth_svc = daemon.auth_service
            assert auth_svc.issue("pkg-e2e-001", "bilibili:default", "test-operator", "人工审核通过", 300) is not None
            # 重新扫描（旧包已处理：轮询后租约存在；为测授权路径，直接再跑一次同一包）
            processed2 = await daemon.poll_and_process_once()
            # 再次处理因 lease 已占用会被忽略；改用第二包验证授权路径
            targets2 = [
                {**targets[0], "account_ref": "acc2"},
                {**targets[1], "account_ref": "acc2"},
                {**targets[2], "account_ref": "acc2"},
            ]
            manifest2 = build_signed_manifest("pkg-e2e-002", targets2)
            task2 = incoming_dir / "pkg-e2e-002"
            (task2 / "renders").mkdir(parents=True)
            (task2 / "timeline").mkdir(parents=True)
            (task2 / "renders" / "short.mp4").write_bytes(b"FAKE_VIDEO_CONTENT_DATA_STREAM")
            (task2 / "timeline" / "subtitle.srt").write_text("1\n00:00:00,000 --> 00:00:02,000\ntest\n")
            (task2 / "timeline" / "timeline.json").write_text(json.dumps({"fps": 30, "totalFrames": 60, "entries": []}))
            (task2 / "manifest.json").write_text(json.dumps(manifest2, ensure_ascii=False, indent=2), encoding="utf-8")
            (task2 / ".transfer-complete").write_text("done")
            auth_svc.issue("pkg-e2e-002", "bilibili:acc2", "test-operator", "人工审核通过", 300)
            processed3 = await daemon.poll_and_process_once()
            assert processed3 == 1
            assert fake_adapters["bilibili"].submit_called == 1
            assert fake_adapters["x"].submit_called == 0  # 未授权 publish → 不提交
            assert fake_adapters["douyin"].submit_called == 0  # draft_only → 不签发最终授权

            # ③ 回执与审计链
            receipt_file = task2 / "receipt.json"
            assert receipt_file.exists()
            receipt = json.loads(receipt_file.read_text(encoding="utf-8"))
            assert receipt["package_id"] == "pkg-e2e-002"
            assert "target_state" in receipt
            assert receipt["target_state"]["bilibili:acc2"] == TargetStatus.CONFIRMED.value
            assert receipt["target_state"]["x:acc2"] == TargetStatus.READY_TO_REVIEW.value
            assert receipt["target_state"]["douyin:acc2"] == TargetStatus.READY_TO_REVIEW.value
            chain_ok, event_count, err = daemon.audit_log.verify_chain_integrity()
            assert chain_ok is True
            assert event_count > 10
            # ④ 重复消费 nonce 拒绝（重放）
            assert auth_svc.consume_pending("pkg-e2e-002", "bilibili:acc2") is None
            print("✓ e2e: 签名 manifest + operator 授权 + draft_only 停草稿 + 回执/审计链 全部通过")

    asyncio.run(_run())


if __name__ == "__main__":
    test_full_e2e_publishing_pipeline_with_operator_auth()
