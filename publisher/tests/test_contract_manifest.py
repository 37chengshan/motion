import base64
import hashlib
import json
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from backend.contracts.ed25519 import public_key_from_secret, sign
from backend.contracts.jcs import jcs_serialize
from backend.contracts.package_manifest import validate_package_manifest

SEED = b"pytest-manifest-key-v1"
RAW_PUB = public_key_from_secret(SEED)
SPKI_DER = bytes.fromhex("302a300506032b6570032100") + RAW_PUB
PUB_PEM = "-----BEGIN PUBLIC KEY-----\n" + base64.b64encode(SPKI_DER).decode() + "\n-----END PUBLIC KEY-----"


def _sign(m: dict) -> dict:
    canon = json.dumps({**m, "signature": {"algorithm": "Ed25519", "key_id": "k1", "canonicalization": "JCS"}}, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    m["signature"] = {"algorithm": "Ed25519", "key_id": "k1", "canonicalization": "JCS", "value": base64.urlsafe_b64encode(sign(SEED, canon)).rstrip(b"=").decode()}
    return m


def build_manifest(**overrides) -> dict:
    video = b"FAKE_VIDEO"
    m = {
        "schema_version": 1,
        "package_id": "pkg-test-manifest-1",
        "run_id": "ai-news-morning-2026-08-28",
        "workflow": "hyperframes",
        "stream": "ai-news",
        "edition": "morning",
        "cadence": "daily",
        "created_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat(),
        "producer_commit": "0" * 40,
        "package_state": "READY_FOR_PUBLISH",
        "assets": [{"path": "renders/short.mp4", "type": "video", "size_bytes": len(video), "mime": "video/mp4", "width": 1080, "height": 1920, "duration_ms": 30000, "sha256": hashlib.sha256(video).hexdigest()}],
        "targets": [{"platform": "bilibili", "account_ref": "default", "title": "t", "description": "d", "tags": ["x"], "statement": "s", "subtitle_path": "timeline/subtitle.srt", "cover_path": "covers/cover.png", "publish_policy": "draft_only"}],
        "timeline": {"path": "timeline/timeline.json", "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "block_count": 8},
        "content_refs": {"source_snapshots": []},
        "review": {"status": "completed", "verdict": "pass", "reports": []},
        **overrides,
    }
    return _sign(m)


def _write_package(manifest: dict) -> Path:
    d = Path(tempfile.mkdtemp())
    (d / "renders").mkdir()
    (d / "timeline").mkdir()
    (d / "renders" / "short.mp4").write_bytes(b"FAKE_VIDEO")
    (d / "timeline" / "subtitle.srt").write_text("1\n00:00:00,000 --> 00:00:01,000\nx\n")
    (d / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return d


def test_valid_manifest_passes():
    d = _write_package(build_manifest())
    assert validate_package_manifest(d / "manifest.json", PUB_PEM) == []


def test_tampered_signature_rejected():
    m = build_manifest()
    m["title"] = "hacked"
    d = _write_package(m)
    errs = validate_package_manifest(d / "manifest.json", PUB_PEM)
    assert any("验签失败" in e for e in errs)


def test_hash_mismatch_rejected():
    d = _write_package(build_manifest())
    (d / "renders" / "short.mp4").write_bytes(b"TAMPERED-BYTES")
    errs = validate_package_manifest(d / "manifest.json", PUB_PEM)
    assert any("sha256 不匹配" in e for e in errs)


def test_path_traversal_rejected():
    m = build_manifest()
    m["assets"] = [{"path": "../evil.mp4", "type": "video", "size_bytes": 9, "mime": "video/mp4", "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}]
    d = _write_package(m)
    errs = validate_package_manifest(d / "manifest.json", PUB_PEM)
    assert any("路径非法" in e for e in errs)


def test_missing_subtitle_rejected():
    m = build_manifest()
    d = _write_package(m)
    (d / "timeline" / "subtitle.srt").unlink()
    errs = validate_package_manifest(d / "manifest.json", PUB_PEM)
    assert any("字幕" in e for e in errs)


def test_review_error_and_fail_rejected():
    for review in ({"status": "error", "verdict": "unknown"}, {"status": "completed", "verdict": "fail"}):
        m = build_manifest(review=review)
        d = _write_package(m)
        errs = validate_package_manifest(d / "manifest.json", PUB_PEM)
        assert errs, f"review {review} 应被拒绝"


def test_warning_with_high_issue_rejected():
    m = build_manifest(review={"status": "completed", "verdict": "warning", "reports": [{"issues": [{"severity": "high"}]}]})
    d = _write_package(m)
    errs = validate_package_manifest(d / "manifest.json", PUB_PEM)
    assert any("high" in e for e in errs)


def test_expired_package_rejected():
    m = build_manifest(expires_at=(datetime.now(timezone.utc) - timedelta(hours=1)).isoformat())
    d = _write_package(m)
    errs = validate_package_manifest(d / "manifest.json", PUB_PEM)
    assert any("过期" in e for e in errs)


def test_missing_or_unknown_publish_policy_rejected():
    for policy in (None, "auto"):
        t = {"platform": "bilibili", "account_ref": "default", "title": "t", "description": "d", "tags": [], "statement": "s", "subtitle_path": "timeline/subtitle.srt", "cover_path": "covers/cover.png"}
        if policy is not None:
            t["publish_policy"] = policy
        m = build_manifest(targets=[t])
        d = _write_package(m)
        errs = validate_package_manifest(d / "manifest.json", PUB_PEM)
        assert any("publish_policy" in e for e in errs), f"policy={policy} 应被拒绝"


def test_jcs_interop_with_committed_vectors():
    """Python JCS 与 contracts/vectors 字节一致（三方互验）"""
    expected = json.loads(Path("../contracts/vectors/expected.json").read_text(encoding="utf-8"))
    stored_jcs = Path("../contracts/vectors/manifest-01.jcs.json").read_text(encoding="utf-8")
    manifest01 = json.loads(Path("../contracts/vectors/manifest-01.json").read_text(encoding="utf-8"))
    canonical = jcs_serialize({**manifest01, "signature": {"algorithm": "Ed25519", "key_id": "test-key-1", "canonicalization": "JCS"}})
    assert canonical == stored_jcs
    # 验签：Python 纯实现 vs 提交的签名值
    from backend.contracts.ed25519 import verify_pem
    assert verify_pem(expected["public_key_pem"], expected["vectors"][0]["signature_value"], stored_jcs.encode()) is True
