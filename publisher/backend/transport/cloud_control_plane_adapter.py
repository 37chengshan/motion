"""Cloud Control Plane 传输适配器（§8.2/§8.5）

轮询 GET /api/v1/packages?consumer=mac&state=ready → 下载各 asset（短时 signed URL）
→ 本地验包（与 LocalWatch 同一 validate_package_manifest 门）→ 完成后回执 POST（幂等键）。
支持指数退避重试（由调用方传入 attempt 决定 sleep）。白天离线/晚间联网场景由 daemon 轮询驱动。
"""
import asyncio
import json
import logging
import time
from pathlib import Path
from typing import List, Optional

import httpx

from .base_transport import BaseTransport
from ..conf import INCOMING_DIR
from ..contracts.package_manifest import PackageManifest, validate_package_manifest, write_rejection_receipt, compute_file_sha256

logger = logging.getLogger("cloud_control_plane_transport")

COMPLETE_MARKER = ".transfer-complete"


class CloudControlPlaneAdapter(BaseTransport):
    def __init__(
        self,
        base_url: str,
        device_token: str,
        public_key_pem: str,
        incoming_dir: Optional[Path] = None,
        timeout_sec: float = 60.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.device_token = device_token
        self.public_key_pem = public_key_pem
        self.incoming_dir = incoming_dir or INCOMING_DIR
        self.timeout_sec = timeout_sec
        self._headers = {"Authorization": "Bearer " + device_token}

    async def fetch_pending_packages(self) -> List[PackageManifest]:
        async with httpx.AsyncClient(timeout=self.timeout_sec, headers=self._headers) as client:
            r = await client.get(self.base_url + "/api/v1/packages", params={"consumer": "mac", "state": "ready"})
            if r.status_code != 200:
                logger.error(f"[CloudCP] 列表拉取失败 HTTP {r.status_code}")
                return []
            items = r.json().get("data", [])
        manifests = []
        for item in items:
            pkg_id = item["package_id"]
            dest = self.incoming_dir / pkg_id
            dest.mkdir(parents=True, exist_ok=True)
            try:
                ok = await self._download_package(pkg_id, dest)
                if ok:
                    manifests.append(PackageManifest.from_file(dest / "manifest.json"))
            except Exception as e:  # noqa: BLE001
                logger.error(f"[CloudCP] {pkg_id} 下载/验包失败: {e}")
        return manifests

    async def _download_package(self, pkg_id: str, dest: Path) -> bool:
        async with httpx.AsyncClient(timeout=self.timeout_sec, headers=self._headers) as client:
            m = await client.get(self.base_url + f"/api/v1/packages/{pkg_id}/manifest")
            if m.status_code != 200:
                logger.error(f"[CloudCP] {pkg_id} manifest 拉取失败 HTTP {m.status_code}")
                return False
            manifest = m.json()["data"]
            (dest / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
            for asset in manifest["assets"]:
                rel = Path(asset["path"])
                target = dest / rel
                # 断点续传：已存在且哈希一致则跳过
                if target.exists() and compute_file_sha256(target) == asset["sha256"]:
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                # 元数据请求（control plane）与内容请求（GCS）分开建 client，重试也建新 client，
                # 避免跨 host 的连接复用被中间代理断开
                async with httpx.AsyncClient(timeout=self.timeout_sec, headers=self._headers) as c_meta:
                    dl = await c_meta.get(self.base_url + f"/api/v1/packages/{pkg_id}/assets/{asset['path'].replace('/', '%2F')}")
                if dl.status_code != 200:
                    logger.error(f"[CloudCP] asset 下载失败 {asset['path']} HTTP {dl.status_code}")
                    return False
                signed = dl.json()["data"]["url"]
                blob_url = signed if signed.startswith("http") else (self.base_url + signed)
                blob = None
                for attempt in range(3):
                    try:
                        async with httpx.AsyncClient(timeout=self.timeout_sec, headers=self._headers) as c_blob:
                            blob = await c_blob.get(blob_url)
                        if blob.status_code == 200:
                            break
                    except Exception as e:  # noqa: BLE001
                        logger.warning(f"[CloudCP] asset 下载第 {attempt + 1} 次失败: {e}")
                        await asyncio.sleep(2 ** attempt)
                if blob is None or blob.status_code != 200:
                    logger.error(f"[CloudCP] asset 内容下载失败 {asset['path']} (retry exhausted)")
                    return False
                target.write_bytes(blob.content)
        errors = validate_package_manifest(dest / "manifest.json", self.public_key_pem)
        if errors:
            write_rejection_receipt(dest, "; ".join(errors))
            logger.error(f"[CloudCP] {pkg_id} 验包失败: {errors}")
            return False
        (dest / COMPLETE_MARKER).write_text(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        return True

    async def acknowledge_package(self, package_id: str, receipt: dict) -> bool:
        key = receipt.get("idempotency_key", package_id)
        target_id = receipt.get("target_id", "default")
        body = {
            "target_id": target_id,
            "idempotency_key": key,
            "status": receipt.get("target_state", receipt.get("status", "")),
            "post_id": receipt.get("post_id"),
            "error_code": receipt.get("error_code"),
            "audit_hash": receipt.get("audit_hash"),
        }
        async with httpx.AsyncClient(timeout=self.timeout_sec, headers=self._headers) as client:
            r = await client.post(self.base_url + f"/api/v1/packages/{package_id}/receipts", json=body)
            return r.status_code in (200, 201)
