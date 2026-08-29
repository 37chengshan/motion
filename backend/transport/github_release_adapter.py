import hashlib
import json
import logging
import os
import re
import subprocess
from pathlib import Path
from typing import List, Optional

from .base_transport import BaseTransport
from ..conf import INCOMING_DIR
from ..models.contract import TaskPackage, AssetSpec

logger = logging.getLogger("github_transport")
def compute_file_sha256(file_path: Path) -> str:
    """分块流式计算 SHA-256，防止大视频文件一次性读入引发内存 OOM"""
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

class GitHubReleaseAdapter(BaseTransport):
    """
    GitHub Releases 资产总线适配器 (单文件上限 2GiB，零云服务器成本)。
    通过 GitHub CLI (gh) 或 REST API 拉取带 `publish-` 标签的私有 Releases。
    """

    def __init__(self, repo: str, incoming_dir: Optional[Path] = None):
        import re as _re
        # 校验 repo 格式防注入 (owner/repo)
        if not _re.match(r"^[\w.\-]+/[\w.\-]+$", repo or ""):
            raise ValueError(f"非法 GitHub repo 格式: {repo}")
        self.repo = repo
        self.incoming_dir = incoming_dir or INCOMING_DIR

    async def fetch_pending_packages(self) -> List[TaskPackage]:
        """轮询并拉取 GitHub Releases 中待发布的任务包"""
        packages = []
        try:
            # 1. 查询 Releases 列表
            cmd = ["gh", "release", "list", "-R", self.repo, "--limit", "10", "--json", "tagName,name,isDraft"]
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            if proc.returncode != 0:
                logger.warning(f"[GitHubTransport] 获取 Releases 失败: {proc.stderr}")
                return []

            releases = json.loads(proc.stdout)
            for rel in releases:
                tag = rel.get("tagName", "")
                if not tag.startswith(("publish-", "job-")):
                    continue

                # 下载到本地独立工作目录 (校验 tag 防路径穿越)
                if not re.match(r"^[a-zA-Z0-9][a-zA-Z0-9_\-\.]{2,64}$", tag):
                    logger.warning(f"[GitHubTransport] 跳过非法 tag {tag}")
                    continue
                task_dir = (self.incoming_dir / tag).resolve()
                try:
                    task_dir.relative_to(self.incoming_dir.resolve())
                except ValueError:
                    logger.warning(f"[GitHubTransport] tag 路径穿越拦截 {tag}")
                    continue
                task_dir.mkdir(parents=True, exist_ok=True)
                manifest_file = task_dir / "manifest.json"

                if not manifest_file.exists():
                    logger.info(f"[GitHubTransport] 发现新任务 Release: {tag}，正在拉取资产...")
                    dl_cmd = ["gh", "release", "download", tag, "-R", self.repo, "-D", str(task_dir), "--clobber"]
                    dl_proc = subprocess.run(dl_cmd, capture_output=True, text=True, timeout=120)
                    if dl_proc.returncode != 0:
                        logger.error(f"[GitHubTransport] 资产下载失败 {tag}: {dl_proc.stderr}")
                        continue

                if manifest_file.exists():
                    manifest_data = json.loads(manifest_file.read_text(encoding="utf-8"))
                    pkg = TaskPackage.from_dict(manifest_data)

                    # 补齐本地路径并校验 SHA-256（流式分块）
                    pkg_valid = True
                    for asset in pkg.assets:
                        local_f = task_dir / asset.filename
                        if not local_f.exists():
                            logger.error(f"[GitHubTransport] 任务包 {tag} 缺少资产文件: {asset.filename}")
                            pkg_valid = False
                            break
                        asset.local_path = str(local_f)
                        if asset.sha256:
                            sha = compute_file_sha256(local_f)
                            if sha != asset.sha256:
                                logger.error(f"[GitHubTransport] 资产校验失败 {asset.filename}: 哈希不匹配 (期望 {asset.sha256}, 实际 {sha})！")
                                pkg_valid = False
                                break

                    if pkg_valid:
                        packages.append(pkg)
                    else:
                        logger.warning(f"[GitHubTransport] 任务包 {tag} 校验未通过，已被安全阻断！")

        except Exception as e:
            logger.error(f"[GitHubTransport] 轮询异常: {e}")

        return packages

    async def acknowledge_package(self, task_id: str, success: bool, payload: dict) -> bool:
        """回写发布结果 Markdown 摘要至 GitHub Release 页面"""
        try:
            status_text = "SUCCESS" if success else "FAILED"
            summary_md = f"### 发布结果回执 [{status_text}]\n\n"
            summary_md += f"- **Task ID**: `{task_id}`\n"
            summary_md += f"- **状态**: {status_text}\n"
            if payload.get("urls"):
                summary_md += "#### 公开发布链接:\n"
                for p, u in payload["urls"].items():
                    summary_md += f"- **{p}**: [{u}]({u})\n"
            if payload.get("errors"):
                summary_md += "#### 错误详情:\n"
                for p, err in payload["errors"].items():
                    summary_md += f"- **{p}**: `{err}`\n"

            tag = f"job-{task_id}"
            cmd = ["gh", "release", "edit", tag, "-R", self.repo, "--notes", summary_md]
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            return proc.returncode == 0
        except Exception as e:
            logger.error(f"[GitHubTransport] 回写 Release 失败: {e}")
            return False
