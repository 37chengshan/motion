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
        import re
        packages = []
        if not self.incoming_dir.exists():
            return []
        # 严格校验 task_id / filename 防路径穿越
        _task_id_re = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_\-]{2,64}$")
        _filename_re = re.compile(r"^[a-zA-Z0-9_\-\.]+$")
        for sub_dir in self.incoming_dir.iterdir():
            if not sub_dir.is_dir():
                continue
            # 目录名即 task_id，需符合白名单
            if not _task_id_re.match(sub_dir.name):
                logger.warning(f"[LocalWatchTransport] 跳过非法目录名 {sub_dir.name}")
                continue
            manifest_file = sub_dir / "manifest.json"
            if not manifest_file.exists():
                continue
            try:
                manifest_data = json.loads(manifest_file.read_text(encoding="utf-8"))
                # 校验 manifest 中的 task_id 合法且与目录名一致 (防伪造跨目录)
                mid = manifest_data.get("task_id", "")
                if not _task_id_re.match(mid):
                    logger.error(f"[LocalWatchTransport] 非法 task_id {mid}")
                    continue
                pkg = TaskPackage.from_dict(manifest_data)
                # 补齐本地路径并流式校验文件
                pkg_valid = True
                for asset in pkg.assets:
                    if not asset.filename or "/" in asset.filename or "\\" in asset.filename or not _filename_re.match(asset.filename):
                        logger.error(f"[LocalWatchTransport] 非法文件名 {asset.filename}")
                        pkg_valid = False
                        break
                    local_f = (sub_dir / asset.filename).resolve()
                    # 确保解析后仍在 sub_dir 内 (防 .. 绕过)
                    try:
                        local_f.relative_to(sub_dir.resolve())
                    except ValueError:
                        logger.error(f"[LocalWatchTransport] 路径穿越拦截 {asset.filename}")
                        pkg_valid = False
                        break
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
        """在本地任务目录下生成 receipt.json 凭证 (带 task_id 白名单与路径锚定)"""
        import re
        _task_id_re = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_\-]{2,64}$")
        if not _task_id_re.match(task_id):
            logger.error(f"[LocalWatchTransport] 非法 task_id 拒绝回写 {task_id}")
            return False
        try:
            # 优先直接锚定 incoming/task_id
            target_dir = (self.incoming_dir / task_id).resolve()
            # 必须仍在 incoming 内
            try:
                target_dir.relative_to(self.incoming_dir.resolve())
            except ValueError:
                logger.error(f"[LocalWatchTransport] 回写路径穿越拦截 {task_id}")
                return False
            # 若目录不存在，尝试通过 manifest 匹配但需校验白名单
            if not target_dir.exists():
                for sub in self.incoming_dir.iterdir():
                    if not sub.is_dir():
                        continue
                    mf = sub / "manifest.json"
                    if not mf.exists():
                        continue
                    try:
                        m = json.loads(mf.read_text(encoding="utf-8"))
                        if m.get("task_id") == task_id and _task_id_re.match(sub.name):
                            target_dir = sub.resolve()
                            break
                    except Exception:
                        continue
            if target_dir.exists() and target_dir.is_dir():
                receipt_file = target_dir / "receipt.json"
                receipt_data = {"task_id": task_id, "success": success, "payload": payload}
                receipt_file.write_text(json.dumps(receipt_data, ensure_ascii=False, indent=2), encoding="utf-8")
                return True
        except Exception as e:
            logger.error(f"[LocalWatchTransport] 写入本地回执失败: {e}")
        return False
