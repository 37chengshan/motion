import asyncio
import json
import logging
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..conf import DB_PATH, DEFAULT_LEASE_DURATION_SEC, INCOMING_DIR
from ..models.contract import TaskPackage, AssetSpec, TargetSpec
from ..models.policy import PublishAuthorization
from ..models.state import TargetStatus
from .lease_manager import LeaseManager
from .session_guard import SessionGuard
from .system_enhancements import MacPowerGuard, MediaStorageGC
from ..audit.hash_chain import HashChainedAuditLog
from ..engine.state_machine import TargetStateMachine
from ..engine.reconciler import StateReconciler
from ..engine.scheduler import FairResourceScheduler
from ..transport.base_transport import BaseTransport
from ..transport.local_watch_adapter import LocalWatchAdapter
from ..transport.github_release_adapter import GitHubReleaseAdapter
from .authorization import OperatorAuthorizationService

# 平台能力适配器导入
from ..impl.bilibili.platform import BilibiliPlatformAdapter
from ..impl.xiaohongshu.platform import XiaohongshuPlatformAdapter
from ..impl.douyin.platform import DouyinPlatformAdapter
from ..impl.kuaishou.platform import KuaishouPlatformAdapter
from ..impl.channels.platform import ChannelsPlatformAdapter
from ..impl.tiktok.platform import TikTokPlatformAdapter
from ..impl.x.api_adapter import XAPIAdapter
from ..impl.youtube.api_adapter import YouTubeAPIAdapter

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(name)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("publisher_daemon")

PUBLISHER_COMMIT = os.environ.get("PUBLISHER_COMMIT", "")


def _load_public_key() -> str:
    pem = os.environ.get("PUBLIC_KEY_PEM", "")
    p = os.environ.get("PUBLISHER_PUBLIC_KEY_PATH", "")
    if pem:
        return pem
    if p:
        return Path(p).read_text(encoding="utf-8")
    return ""


def manifest_to_task(manifest) -> TaskPackage:
    """PackageManifest -> TaskPackage（§8.3）：视频/封面/SRT/metadata 全部来自 package；
    review/timeline 作为证据只读保存（不参与生成）。"""
    assets = []
    for a in manifest.assets:
        if a.type == "video":
            asset_type = "video"
        elif a.type in ("image",):
            asset_type = "cover"
        else:
            asset_type = a.type
        assets.append(
            AssetSpec(
                asset_id=a.path,
                type=asset_type,
                filename=Path(a.path).name,
                sha256=a.sha256,
                size_bytes=a.size_bytes,
                mime=a.mime,
                width=a.width,
                height=a.height,
                local_path=str(manifest.package_dir / a.path),
            )
        )
    targets = []
    for t in manifest.targets:
        targets.append(
            TargetSpec(
                target_id=f"{t.platform}:{t.account_ref}",
                platform=t.platform,
                account_ref=t.account_ref,
                publish_policy=t.publish_policy,
                schedule_time="",
            )
        )
    title = manifest.targets[0].title if manifest.targets else manifest.run_id
    pkg = TaskPackage(
        package_version="2.0.0",
        task_id=manifest.package_id,
        idempotency_key=f"idem-{manifest.package_id}",
        producer="windows_producer",
        created_at=manifest.created_at,
        expires_at=manifest.expires_at,
        assets=assets,
        canonical_content={
            "title": title,
            "description": manifest.targets[0].description if manifest.targets else "",
            "tags": manifest.targets[0].tags if manifest.targets else [],
            "ai_declaration": manifest.targets[0].statement if manifest.targets else "",
        },
        targets=targets,
    )
    pkg.calculate_dedupe_key()
    return pkg


class MasterPublisherDaemon:
    """Mac 专属发布节点守护进程（§8.3）：输入为签名 PackageManifest；
    不生成媒体/不调用 AIPING/agy/whisper/不执行 producer 脚本；
    无自动授权：publish 目标必须由 operator 显式签发一次性 nonce。"""

    def __init__(
        self,
        worker_id: str = "mac_publisher_node_01",
        github_repo: Optional[str] = None,
        db_path: Optional[Path] = None,
        incoming_dir: Optional[Path] = None,
        public_key_pem: str = "",
        auth_service: Optional[OperatorAuthorizationService] = None,
    ):
        self.worker_id = worker_id
        self.db_path = db_path or DB_PATH
        self.incoming_dir = incoming_dir or INCOMING_DIR
        self.public_key_pem = public_key_pem or _load_public_key()
        self.lease_mgr = LeaseManager(self.db_path)
        self.session_guard = SessionGuard(self.db_path)
        self.audit_log = HashChainedAuditLog(self.db_path)
        self.state_machine = TargetStateMachine(self.lease_mgr, self.audit_log)
        self.reconciler = StateReconciler(self.state_machine, self.audit_log)
        self.scheduler = FairResourceScheduler(self.lease_mgr, self.state_machine, self.reconciler)
        self.auth_service = auth_service or OperatorAuthorizationService(self.db_path)

        self.power_guard = MacPowerGuard()
        self.storage_gc = MediaStorageGC(self.incoming_dir, retention_days=3)

        self.platform_adapters: Dict[str, Any] = {
            "bilibili": BilibiliPlatformAdapter(),
            "xiaohongshu": XiaohongshuPlatformAdapter(),
            "douyin": DouyinPlatformAdapter(),
            "kuaishou": KuaishouPlatformAdapter(),
            "channels": ChannelsPlatformAdapter(),
            "tiktok": TikTokPlatformAdapter(),
            "x": XAPIAdapter(),
            "youtube": YouTubeAPIAdapter(),
        }

        self.transports: List[BaseTransport] = [LocalWatchAdapter(self.incoming_dir, self.public_key_pem)]
        if github_repo:
            self.transports.append(GitHubReleaseAdapter(github_repo, self.incoming_dir))
        # Cloud Control Plane 适配器（白天离线/晚间回家优先拉取；失败回退本地扫描）
        cp_url = os.environ.get("CONTROL_PLANE_URL", "")
        mac_token = os.environ.get("MAC_DEVICE_TOKEN", "")
        if cp_url and mac_token and self.public_key_pem:
            from ..transport.cloud_control_plane_adapter import CloudControlPlaneAdapter

            self.transports.insert(0, CloudControlPlaneAdapter(cp_url, mac_token, self.public_key_pem, self.incoming_dir))
            logger.info("[PublisherDaemon] 已启用 Cloud Control Plane 传输通道")

        logger.info(f"[PublisherDaemon] 初始化完成: worker_id={worker_id}, {len(self.transports)} 传输通道, 自动授权已禁用")

    async def poll_and_process_once(self) -> int:
        processed_count = 0
        chain_ok, count, err = self.audit_log.verify_chain_integrity()
        if not chain_ok:
            logger.critical(f"[PublisherDaemon] 审计日志链防篡改校验失败: {err}！暂停调度")
            return 0
        self.storage_gc.run_cleanup()

        for transport in self.transports:
            try:
                manifests = await transport.fetch_pending_packages()
                for manifest in manifests:
                    self.power_guard.prevent_sleep(f"Processing package {manifest.package_id}")
                    try:
                        if await self._process_single_package(manifest, transport):
                            processed_count += 1
                    finally:
                        self.power_guard.allow_sleep()
            except Exception as e:  # noqa: BLE001
                logger.error(f"[PublisherDaemon] Transport 轮询异常: {e}")
        return processed_count

    async def _process_single_package(self, manifest, transport: BaseTransport) -> bool:
        pkg = manifest_to_task(manifest)
        package_id = manifest.package_id
        logger.info(f"[PublisherDaemon] 发现待处理包: package_id={package_id}, run_id={manifest.run_id}")

        claimed, token, version, reason = self.lease_mgr.claim_task(
            package=pkg, worker_id=self.worker_id, lease_duration_sec=DEFAULT_LEASE_DURATION_SEC
        )
        if not claimed:
            logger.info(f"[PublisherDaemon] 包忽略（未领取）: {package_id} 原因: {reason}")
            return False

        # 授权（§8.3/8.4）：publish 目标必须消费 operator 一次性 nonce；draft_only/无授权 → 停在 READY_TO_REVIEW
        authorizations: Dict[str, PublishAuthorization] = {}
        for target in pkg.targets:
            if target.publish_policy == "draft_only":
                continue
            record = self.auth_service.consume_pending(package_id, target.target_id)
            if record:
                authorizations[target.target_id] = PublishAuthorization(
                    authorization_id=f"auth-{record['nonce'][:8]}",
                    task_id=package_id,
                    target_id=target.target_id,
                    authorized_at=record["created_at"],
                    authorized_by=f"operator:{record['operator']}",
                    expires_at=record["expires_at"],
                    scope="single_target",
                )
                self.audit_log.record_event(
                    task_id=package_id, target_id=target.target_id, event_type="AUTHORIZATION_CONSUMED",
                    payload={"operator": record["operator"], "reason": record["reason"]},
                )
            else:
                logger.info(f"[PublisherDaemon] {package_id}:{target.target_id} 等待 operator 授权（无 nonce，停在草稿）")

        target_results = await self.scheduler.execute_task_package(
            package=pkg,
            lease_token=token,
            claim_version=version,
            platform_adapters=self.platform_adapters,
            authorizations=authorizations,
        )

        # 回执（本地 + Cloud 幂等；含审计 hash 与 publisher commit）
        latest_audit = self.audit_log.get_latest_hash() if hasattr(self.audit_log, "get_latest_hash") else ""
        receipt = {
            "package_id": package_id,
            "task_id": pkg.task_id,
            "idempotency_key": pkg.idempotency_key,
            "target_state": {t_id: st.value for t_id, st in target_results.items()},
            "post_id": "",
            "post_url": "",
            "error_code": "",
            "audit_hash": latest_audit,
            "publisher_commit": PUBLISHER_COMMIT or manifest.producer_commit,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }
        await transport.acknowledge_package(package_id, receipt)
        logger.info(f"[PublisherDaemon] 包执行完毕: {package_id} 结果: {receipt['target_state']}")
        return True

    async def start_loop(self, interval_sec: int = 10):
        logger.info(f"[PublisherDaemon] 常驻主循环启动，轮询间隔: {interval_sec} 秒")
        while True:
            try:
                await self.poll_and_process_once()
            except Exception as e:  # noqa: BLE001
                logger.error(f"[PublisherDaemon] 轮询异常: {e}")
            await asyncio.sleep(interval_sec)
