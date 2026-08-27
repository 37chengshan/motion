import hashlib
import json
import logging
from pathlib import Path
from typing import List, Optional

from .base_transport import BaseTransport
from ..conf import INCOMING_DIR
from ..models.contract import TaskPackage

logger = logging.getLogger("local_watch_transport")
def compute_file_sha256(file_path: Path) -> str:
    """分块流式计算 SHA-256"""
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

class LocalWatchAdapter(BaseTransport):
    """
    本地与局域网 Watcher 适配器 (支持 Syncthing, Tailscale, SMB, 本地文件夹同步)。
    扫描 `data/incoming/` 目录下的子任务目录。
    """

    def __init__(self, incoming_dir: Optional[Path] = None):
        self.incoming_dir = incoming_dir or INCOMING_DIR

    async def fetch_pending_packages(self) -> List[TaskPackage]:
        packages = []
        if not self.incoming_dir.exists():
            return []

        for sub_dir in self.incoming_dir.iterdir():
            if not sub_dir.is_dir():
                continue

            manifest_file = sub_dir / "manifest.json"
            if not manifest_file.exists():
                continue

            try:
                manifest_data = json.loads(manifest_file.read_text(encoding="utf-8"))
                pkg = TaskPackage.from_dict(manifest_data)

                # 补齐本地路径并流式校验文件
                pkg_valid = True
                for asset in pkg.assets:
                    local_f = sub_dir / asset.filename
                    if not local_f.exists():
                        logger.error(f"[LocalWatchTransport] 目录 {sub_dir.name} 缺少文件: {asset.filename}")
                        pkg_valid = False
                        break
                    asset.local_path = str(local_f)
                    if not asset.sha256:
                        asset.sha256 = compute_file_sha256(local_f)
                    else:
                        real_sha = compute_file_sha256(local_f)
                        if real_sha != asset.sha256:
                            logger.error(f"[LocalWatchTransport] 哈希不匹配 {asset.filename}")
                            pkg_valid = False
                            break

                if pkg_valid:
                    packages.append(pkg)
            except Exception as e:
                logger.error(f"[LocalWatchTransport] 解析任务包失败 {sub_dir}: {e}")

        return packages

    async def acknowledge_package(self, task_id: str, success: bool, payload: dict) -> bool:
        """在本地任务目录下生成 receipt.json 凭证"""
        try:
            target_dir = self.incoming_dir / task_id
            if not target_dir.exists():
                for sub in self.incoming_dir.iterdir():
                    if (sub / "manifest.json").exists():
                        try:
                            m = json.loads((sub / "manifest.json").read_text(encoding="utf-8"))
                            if m.get("task_id") == task_id:
                                target_dir = sub
                                break
                        except Exception:
                            pass

            if target_dir.exists():
                receipt_file = target_dir / "receipt.json"
                receipt_data = {
                    "task_id": task_id,
                    "success": success,
                    "payload": payload
                }
                receipt_file.write_text(json.dumps(receipt_data, ensure_ascii=False, indent=2), encoding="utf-8")
                return True
        except Exception as e:
            logger.error(f"[LocalWatchTransport] 写入本地回执失败: {e}")
        return False
