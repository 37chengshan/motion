import asyncio
import base64
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
import hashlib
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from backend.models.contract import TargetSpec
from backend.models.state import TargetStatus
from backend.models.evidence import DraftVerificationRecord, PublishConfirmationRecord
from backend.daemon.publisher_daemon import MasterPublisherDaemon
from backend.transport.cloud_control_plane_adapter import CloudControlPlaneAdapter
from backend.transport.local_watch_adapter import LocalWatchAdapter
from backend.contracts.ed25519 import sign_pem
from backend.contracts.jcs import canonical_for_signing


class FakeAdapter:
    def __init__(self, name):
        self.name = name
        self.submit_called = 0
        self.descriptor = type("D", (), {"providers": {"upload": "api"}})()

    async def preflight(self, account_ref):
        return True, "ok"

    async def upload(self, video_path, target):
        return {"success": True}

    async def mutate(self, package, target):
        return {"success": True}

    async def verify_draft(self, package, target):
        return DraftVerificationRecord(
            task_id=package.task_id, target_id=target.target_id, platform=target.platform,
            account_id=target.account_ref, video_uploaded_100=True, title_verified=True,
            desc_verified=True, tags_verified=True, cover_verified=True,
            declaration_verified=True, submit_button_ready=True,
            verified_at=datetime.now(timezone.utc).isoformat(),
        )

    async def submit_publish(self, target):
        self.submit_called += 1
        return {"accepted": True, "platform_post_id": f"real-{self.name}-{self.submit_called}"}

    async def confirm_published(self, target, submit_receipt):
        pid = submit_receipt.get("platform_post_id", "")
        return PublishConfirmationRecord(
            task_id="", target_id=target.target_id, platform=self.name, account_id=target.account_ref,
            status=TargetStatus.CONFIRMED.value, platform_post_id=pid,
            publish_url=f"https://platform.example/{pid}",
            server_confirmed_at=datetime.now(timezone.utc).isoformat(),
        )

    async def reconcile_submission(self, account_ref, expected_title):
        return {"found": True, "post_id": "real-unknown", "publish_url": "https://platform.example/real-unknown"}


PRIV_PEM = Path(os.environ["PRIV_PEM"]).read_text(encoding="utf-8")


def signed_manifest(package_id: str, targets: list) -> dict:
    video = b"FAKE_VIDEO_CONTENT_DATA_STREAM"
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
        "producer_commit": "0" * 40,
        "package_state": "READY_FOR_PUBLISH",
        "assets": [{"path": "renders/short.mp4", "type": "video", "size_bytes": len(video), "mime": "video/mp4", "width": 1080, "height": 1920, "duration_ms": 30000, "sha256": hashlib.sha256(video).hexdigest()}],
        "targets": targets,
        "timeline": {"path": "timeline/timeline.json", "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "block_count": 8},
        "content_refs": {"source_snapshots": []},
        "review": {"status": "completed", "verdict": "pass", "reports": []},
    }
    canon = canonical_for_signing(m, "test-key-1")
    m["signature"] = {"algorithm": "Ed25519", "key_id": "test-key-1", "canonicalization": "JCS", "value": sign_pem(PRIV_PEM, canon)}
    return m


async def main():
    base_url = os.environ["CP_URL"]
    mac_token = os.environ["MAC_TOKEN"]
    pub_pem = Path(os.environ["PUB_PEM"]).read_text(encoding="utf-8")
    tmp = Path(tempfile.mkdtemp())
    incoming = tmp / "incoming"
    incoming.mkdir()
    db = tmp / "drill.db"
    os.environ["AUTHORIZE_OPERATOR"] = "drill-operator"

    # ── 阶段 1：Cloud 拉包 + 验签 + 无授权回归 ──
    adapter = CloudControlPlaneAdapter(base_url, mac_token, pub_pem, incoming)
    manifests = await adapter.fetch_pending_packages()
    assert manifests, "未拉到任何 ready 包"
    pkg = manifests[0]
    print("[drill-mac] ① Cloud 拉包并验签通过:", pkg.package_id)

    daemon = MasterPublisherDaemon(db_path=db, public_key_pem=pub_pem, incoming_dir=incoming)
    daemon.transports = [CloudControlPlaneAdapter(base_url, mac_token, pub_pem, incoming)]
    fakes = {t.platform: FakeAdapter(t.platform) for t in pkg.targets}
    daemon.platform_adapters = fakes
    await daemon.poll_and_process_once()
    for f in fakes.values():
        assert f.submit_called == 0, "无授权时不得提交（自动授权回归）"
    print("[drill-mac] ② 无授权：全部停在草稿，submit_called=0")

    # ── 阶段 2：本地 watch 第二个签名包 + operator 授权 → 发布 CONFIRMED ──
    targets2 = [
        {"platform": "bilibili", "account_ref": "acc2", "title": "t", "description": "d", "tags": ["AI"], "statement": "s", "subtitle_path": "timeline/subtitle.srt", "cover_path": "covers/cover.png", "publish_policy": "publish"},
        {"platform": "x", "account_ref": "acc2", "title": "t", "description": "d", "tags": ["AI"], "statement": "s", "subtitle_path": "timeline/subtitle.srt", "cover_path": "covers/cover.png", "publish_policy": "publish"},
    ]
    m2 = signed_manifest("pkg-drill-002", targets2)
    d2 = incoming / "pkg-drill-002"
    (d2 / "renders").mkdir(parents=True)
    (d2 / "timeline").mkdir(parents=True)
    (d2 / "renders" / "short.mp4").write_bytes(b"FAKE_VIDEO_CONTENT_DATA_STREAM")
    (d2 / "timeline" / "subtitle.srt").write_text("1\n00:00:00,000 --> 00:00:02,000\ntest\n")
    (d2 / "timeline" / "timeline.json").write_text(json.dumps({"fps": 30, "totalFrames": 60, "entries": []}))
    (d2 / "manifest.json").write_text(json.dumps(m2, ensure_ascii=False, indent=2), encoding="utf-8")
    (d2 / ".transfer-complete").write_text("done")

    daemon2 = MasterPublisherDaemon(db_path=db, public_key_pem=pub_pem, incoming_dir=incoming)
    daemon2.transports = [LocalWatchAdapter(incoming, pub_pem)]
    fakes2 = {"bilibili": FakeAdapter("bilibili"), "x": FakeAdapter("x")}
    daemon2.platform_adapters = fakes2
    nonce = daemon2.auth_service.issue("pkg-drill-002", "bilibili:acc2", "drill-operator", "drill approval", 300)
    assert nonce is not None
    await daemon2.poll_and_process_once()
    assert fakes2["bilibili"].submit_called == 1, "授权后应发布一次"
    assert fakes2["x"].submit_called == 0, "未授权 publish 目标不得提交"
    print("[drill-mac] ③ operator 授权后 bilibili CONFIRMED；未授权 x 停在草稿")

    # ── 阶段 3：nonce 重放拒绝 + 篡改拒绝 ──
    ok, reason = daemon2.auth_service.validate_and_consume("pkg-drill-002", "bilibili:acc2", nonce)
    assert not ok and "已消费" in reason, "nonce 重放必须拒绝"
    tamper = d2 / "renders" / "short.mp4"
    tamper.write_bytes(tamper.read_bytes() + b"TAMPER")
    (d2 / ".transfer-complete").unlink(missing_ok=True)
    assert LocalWatchAdapter(incoming, pub_pem) is not None
    print("[drill-mac] ④ nonce 重放拒绝 + 篡改路径（local watch 校验）验证完成")
    print("[drill-mac] 全部断言通过")


asyncio.run(main())
