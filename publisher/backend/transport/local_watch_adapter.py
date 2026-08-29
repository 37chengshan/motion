import json
import logging
from pathlib import Path
from typing import List, Optional

from .base_transport import BaseTransport
from ..conf import INCOMING_DIR
from ..contracts.package_manifest import PackageManifest, validate_package_manifest, compute_file_sha256

logger = logging.getLogger("local_watch_transport")

COMPLETE_MARKER = ".transfer-complete"


class LocalWatchAdapter(BaseTransport):
    """本地/局域网 Watcher（§8.2）：扫描 incoming/<package-id>/，只处理
    原子完成标记 + manifest 校验成功的包；校验失败写 rejection.json 并不 claim lease。"""

    def __init__(self, incoming_dir: Optional[Path] = None, public_key_pem: str = ""):
        self.incoming_dir = incoming_dir or INCOMING_DIR
        self.public_key_pem = public_key_pem

    async def fetch_pending_packages(self) -> List[PackageManifest]:
        packages = []
        if not self.incoming_dir.exists():
            return []
        for sub_dir in self.incoming_dir.iterdir():
            if not sub_dir.is_dir():
                continue
            manifest_file = sub_dir / "manifest.json"
            if not manifest_file.exists():
                continue
            if not (sub_dir / COMPLETE_MARKER).exists():
                continue  # 原子完成标记缺失 → 视为传输未完成，不处理
            if not self.public_key_pem:
                logger.error(f"[LocalWatchTransport] 未配置公钥，跳过 {sub_dir.name}")
                continue
            errors = validate_package_manifest(manifest_file, self.public_key_pem)
            if errors:
                from ..contracts.package_manifest import write_rejection_receipt
                write_rejection_receipt(sub_dir, "; ".join(errors))
                logger.error(f"[LocalWatchTransport] 验包失败 {sub_dir.name}: {errors}")
                continue
            packages.append(PackageManifest.from_file(manifest_file))
            logger.info(f"[LocalWatchTransport] 通过校验: {sub_dir.name}")
        return packages

    async def acknowledge_package(self, package_id: str, receipt: dict) -> bool:
        """在包目录下写 receipt.json（完整回执字段由调用方提供）"""
        try:
            target_dir = self.incoming_dir / package_id
            if not target_dir.exists():
                for sub in self.incoming_dir.iterdir():
                    if (sub / "manifest.json").exists():
                        try:
                            m = json.loads((sub / "manifest.json").read_text(encoding="utf-8"))
                            if m.get("package_id") == package_id or m.get("task_id") == package_id:
                                target_dir = sub
                                break
                        except Exception:
                            pass
            if target_dir.exists():
                (target_dir / "receipt.json").write_text(
                    json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                return True
        except Exception as e:  # noqa: BLE001
            logger.error(f"[LocalWatchTransport] 写入本地回执失败: {e}")
        return False
