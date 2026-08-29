import asyncio
import logging
import sys
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Dict, Any, Optional

from ..conf import DB_PATH, DEFAULT_LEASE_DURATION_SEC, DEFAULT_AUTH_TTL_SEC, INCOMING_DIR
from ..models.contract import TaskPackage
from ..models.policy import PublishAuthorization
from ..models.state import TaskStatus, TargetStatus
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
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("publisher_daemon")

class MasterPublisherDaemon:
    """Mac 专属发布节点守护进程中枢 (含 Mac 休眠保护、存储自动 GC 与防风控频控)"""

    def __init__(
        self,
        worker_id: str = "mac_publisher_node_01",
        github_repo: Optional[str] = None,
        db_path: Optional[Path] = None,
        incoming_dir: Optional[Path] = None
    ):
        self.worker_id = worker_id
        self.db_path = db_path or DB_PATH
        self.incoming_dir = incoming_dir or INCOMING_DIR
        self.lease_mgr = LeaseManager(self.db_path)
        self.session_guard = SessionGuard(self.db_path)
        self.audit_log = HashChainedAuditLog(self.db_path)
        self.state_machine = TargetStateMachine(self.lease_mgr, self.audit_log)
        self.reconciler = StateReconciler(self.state_machine, self.audit_log)
        self.scheduler = FairResourceScheduler(self.lease_mgr, self.state_machine, self.reconciler)

        # Mac 系统与存储增强
        self.power_guard = MacPowerGuard()
        self.storage_gc = MediaStorageGC(self.incoming_dir, retention_days=3)

        # 注册 8 大平台能力适配器
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

        # 注册输入传输层
        self.transports: List[BaseTransport] = [
            LocalWatchAdapter(self.incoming_dir)
        ]
        if github_repo:
            self.transports.append(GitHubReleaseAdapter(github_repo, self.incoming_dir))

        logger.info(f"[PublisherDaemon] 初始化完成: worker_id={worker_id}, 已加载 8 平台适配器与 {len(self.transports)} 传输通道")

    async def poll_and_process_once(self) -> int:
        """单次轮询处理待分发任务包"""
        processed_count = 0

        # 1. 自检哈希审计链
        chain_ok, count, err = self.audit_log.verify_chain_integrity()
        if not chain_ok:
            logger.critical(f"[PublisherDaemon] 审计日志链防篡改校验失败: {err}！暂停新任务调度以保护现场。")
            return 0

        # 2. 磁盘存储自动垃圾回收
        self.storage_gc.run_cleanup()

        for transport in self.transports:
            try:
                packages = await transport.fetch_pending_packages()
                for pkg in packages:
                    # 在任务执行期间阻断 Mac 息屏/休眠
                    self.power_guard.prevent_sleep(f"Processing task {pkg.task_id}")
                    try:
                        processed = await self._process_single_package(pkg, transport)
                        if processed:
                            processed_count += 1
                    finally:
                        self.power_guard.allow_sleep()
            except Exception as e:
                logger.error(f"[PublisherDaemon] Transport 轮询异常: {e}")

        return processed_count

    async def _process_single_package(self, pkg: TaskPackage, transport: BaseTransport) -> bool:
        """处理单一任务包生命周期"""
        logger.info(f"[PublisherDaemon] 发现待处理任务: task_id={pkg.task_id}, idempotency_key={pkg.idempotency_key}")

        # 1. 原子 Claim 租约获取
        claimed, token, version, reason = self.lease_mgr.claim_task(
            package=pkg,
            worker_id=self.worker_id,
            lease_duration_sec=DEFAULT_LEASE_DURATION_SEC
        )

        if not claimed:
            logger.info(f"[PublisherDaemon] 任务忽略 (未成功领取): {pkg.task_id} 原因: {reason}")
            return False

        logger.info(f"[PublisherDaemon] 任务领取成功: {pkg.task_id} (token={token}, version={version})")

        # 2. 签发发布授权令牌 (根据 Policy Plane 控制 — 默认 draft_only 人审闸门)
        # 原则: DRAFT_READY != AUTHORIZED；自动签发仅在显式开启 AUTO_PUBLISH 时允许
        import os as _os
        _auto_publish = _os.environ.get("PUBLISHER_AUTO_PUBLISH", "0").lower() in ("1", "true", "yes")
        now = datetime.now(timezone.utc)
        auth_exp = (now + timedelta(seconds=DEFAULT_AUTH_TTL_SEC)).isoformat()
        authorizations: dict = {}

        for target in pkg.targets:
            if target.publish_policy != "publish":
                continue
            if not _auto_publish:
                # 默认不签发 — 调度器将停在 READY_TO_REVIEW 等待人工/外部授权
                logger.info(f"[PublisherDaemon] 人审闸门生效 {pkg.task_id}:{target.target_id} 停在 READY_TO_REVIEW (需外部授权)")
                continue
            # 显式开启自动发布时才自签，并落库持久化防重放
            auth = PublishAuthorization(
                authorization_id=f"auth-{uuid.uuid4().hex[:8]}",
                task_id=pkg.task_id,
                target_id=target.target_id,
                authorized_at=now.isoformat(),
                authorized_by="publisher_daemon_auto_policy",
                expires_at=auth_exp,
                scope="single_target"
            )
            # 持久化到 DB
            try:
                with self.lease_mgr._get_connection() as _conn:
                    _conn.execute("""
                        INSERT OR IGNORE INTO publish_authorizations
                        (authorization_id, task_id, target_id, authorized_at, authorized_by, expires_at, scope, nonce, is_consumed)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
                    """, (auth.authorization_id, auth.task_id, auth.target_id, auth.authorized_at, auth.authorized_by, auth.expires_at, auth.scope, auth.nonce))
                    _conn.commit()
            except Exception as _e:
                logger.warning(f"[PublisherDaemon] 授权落库失败 {target.target_id}: {_e}")
            authorizations[target.target_id] = auth
            logger.warning(f"[PublisherDaemon] AUTO_PUBLISH 已开启，自动签发授权 {auth.authorization_id} for {target.target_id}")
        # 3. 调度器执行
        target_results = await self.scheduler.execute_task_package(
            package=pkg,
            lease_token=token,
            claim_version=version,
            platform_adapters=self.platform_adapters,
            authorizations=authorizations
        )

        # 4. 回写状态与确认回执
        all_success = all(st == TargetStatus.CONFIRMED for st in target_results.values())
        payload = {
            "target_results": {t_id: st.value for t_id, st in target_results.items()},
            "processed_at": datetime.now(timezone.utc).isoformat()
        }
        await transport.acknowledge_package(pkg.task_id, all_success, payload)
        logger.info(f"[PublisherDaemon] 任务执行完毕: {pkg.task_id} 结果: {payload['target_results']}")

        return True

    async def start_loop(self, interval_sec: int = 10):
        """常驻守护轮询主循环"""
        logger.info(f"[PublisherDaemon] 常驻主循环启动，轮询间隔: {interval_sec} 秒")
        while True:
            try:
                await self.poll_and_process_once()
            except Exception as e:
                logger.error(f"[PublisherDaemon] 轮询异常: {e}")
            await asyncio.sleep(interval_sec)
