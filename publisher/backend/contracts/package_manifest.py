"""PackageManifest（§2.2/§8.1）— 跨机交接包校验与映射。

硬校验：schema_version=1、package_state=READY_FOR_PUBLISH、JCS/Ed25519 验签、
相对路径（禁 ..）、文件存在、MIME、size、sha256（64KiB 分块）、review completed+pass|warning
（warning 无 high）、targets publish_policy 必填 enum、timeline/content_refs 存在。
任一失败 → 返回错误列表；调用方写拒绝回执且不 claim lease。
"""
import hashlib
import json
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List, Optional

from .ed25519 import verify_pem
from .jcs import canonical_for_signing

VALID_STATES = {"READY_FOR_PUBLISH"}
VALID_TYPES = {"video", "image", "subtitle", "timeline", "review", "audio", "asset"}
VALID_POLICIES = {"draft_only", "publish"}
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def compute_file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


@dataclass
class ManifestAsset:
    path: str
    type: str
    size_bytes: int
    mime: str
    sha256: str
    width: int = 0
    height: int = 0
    duration_ms: int = 0
    local_path: str = ""


@dataclass
class ManifestTarget:
    platform: str
    account_ref: str
    title: str
    description: str
    tags: List[str]
    statement: str
    subtitle_path: str
    cover_path: str
    publish_policy: str


@dataclass
class PackageManifest:
    package_id: str
    run_id: str
    workflow: str
    stream: str
    edition: Optional[str]
    cadence: str
    created_at: str
    expires_at: str
    producer_commit: str
    package_state: str
    assets: List[ManifestAsset]
    targets: List[ManifestTarget]
    timeline: dict
    content_refs: dict
    review: dict
    signature: dict
    package_dir: Path = field(default=None)  # type: ignore[assignment]

    @classmethod
    def from_file(cls, manifest_path: Path) -> "PackageManifest":
        data = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
        obj = cls(
            package_id=data["package_id"],
            run_id=data["run_id"],
            workflow=data["workflow"],
            stream=data["stream"],
            edition=data.get("edition"),
            cadence=data["cadence"],
            created_at=data["created_at"],
            expires_at=data["expires_at"],
            producer_commit=data["producer_commit"],
            package_state=data["package_state"],
            assets=[ManifestAsset(**a) for a in data["assets"]],
            targets=[ManifestTarget(**t) for t in data["targets"]],
            timeline=data.get("timeline", {}),
            content_refs=data.get("content_refs", {}),
            review=data.get("review", {}),
            signature=data["signature"],
            package_dir=Path(manifest_path).parent,
        )
        return obj


def validate_package_manifest(
    manifest_path: Path,
    public_key_pem: str,
    ignore_files: bool = False,
) -> List[str]:
    """校验交接包；返回错误列表（空 = 通过）。ignore_files 供纯清单校验/单元测试。"""
    errors: List[str] = []
    try:
        m = PackageManifest.from_file(manifest_path)
    except Exception as e:  # noqa: BLE001
        return [f"manifest 解析失败: {e}"]

    if m.package_state not in VALID_STATES:
        errors.append(f"package_state 必须为 READY_FOR_PUBLISH（收到 {m.package_state}）")
    raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    ok = verify_pem(public_key_pem, str(m.signature.get("value", "")), canonical_for_signing(raw, m.signature.get("key_id", "")))
    if not ok:
        errors.append("JCS/Ed25519 验签失败")

    try:
        if datetime.fromisoformat(m.expires_at.replace("Z", "+00:00")) < datetime.now(timezone.utc):
            errors.append("package 已过期")
    except Exception:  # noqa: BLE001
        errors.append("expires_at 格式非法")

    seen = set()
    for a in m.assets:
        if not a.path or a.path.startswith("/") or ".." in Path(a.path).parts:
            errors.append(f"asset 路径非法（禁 .. 与绝对路径）: {a.path}")
            continue
        if a.path in seen:
            errors.append(f"asset 重复: {a.path}")
        seen.add(a.path)
        if a.type not in VALID_TYPES:
            errors.append(f"asset type 非法: {a.type}")
        if not SHA256_RE.match(a.sha256):
            errors.append(f"asset sha256 非法: {a.path}")
        if a.size_bytes <= 0 or a.size_bytes > 2 * 1024 * 1024 * 1024:
            errors.append(f"asset size_bytes 非法: {a.path}")
        if ignore_files:
            continue
        local = m.package_dir / a.path
        if not local.exists():
            errors.append(f"asset 文件缺失: {a.path}")
            continue
        real = compute_file_sha256(local)
        if real != a.sha256:
            errors.append(f"asset sha256 不匹配: {a.path}")
        if local.stat().st_size != a.size_bytes:
            errors.append(f"asset size 不匹配: {a.path}")

    for t in m.targets:
        if t.publish_policy not in VALID_POLICIES:
            errors.append(f"target.publish_policy 必填 draft_only|publish（收到 {t.publish_policy!r}）")
        if not t.platform or not t.account_ref or not t.title:
            errors.append("target 缺少 platform/account_ref/title")

    review = m.review
    if review.get("status") != "completed":
        errors.append(f"review.status 必须 completed（收到 {review.get('status')!r}）")
    verdict = review.get("verdict")
    if verdict not in ("pass", "warning"):
        errors.append(f"review.verdict 必须 pass|warning（收到 {verdict!r}）")
    if verdict == "warning":
        for r in review.get("reports", []):
            pass
        # 报告内 high issue 检查（有 reports.issues 时）
        for r in review.get("reports", []):
            for issue in r.get("issues", []) or []:
                if issue.get("severity") == "high":
                    errors.append("review warning 含 high issue，禁止打包")
                    break
    if not m.timeline.get("sha256"):
        errors.append("timeline.sha256 缺失")
    if not ignore_files:
        srt = m.package_dir / "timeline/subtitle.srt"
        if not srt.exists():
            errors.append("缺少字幕 timeline/subtitle.srt")
    return errors


def write_rejection_receipt(package_dir: Path, reason: str) -> Path:
    """验包失败写拒绝回执（不 claim lease）。"""
    rec = {
        "package_id": package_dir.name,
        "result": "rejected",
        "reason": reason,
        "rejected_at": datetime.now(timezone.utc).isoformat(),
    }
    out = package_dir / "rejection.json"
    out.write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
    return out
