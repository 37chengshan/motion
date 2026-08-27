import logging
from typing import Optional, Tuple

from ..models.state import TaskStatus, TargetStatus
from ..models.policy import PublishAuthorization
from ..models.evidence import DraftVerificationRecord, PublishConfirmationRecord
from ..daemon.lease_manager import LeaseManager
from ..audit.hash_chain import HashChainedAuditLog

logger = logging.getLogger("state_machine")

class TargetStateMachine:
    """Target 平台子任务状态流转引擎与安全门禁"""

    def __init__(self, lease_manager: LeaseManager, audit_log: HashChainedAuditLog):
        self.lease_mgr = lease_manager
        self.audit = audit_log

    def transition(
        self,
        task_id: str,
        target_id: str,
        current_status: TargetStatus,
        next_status: TargetStatus,
        lease_token: str,
        claim_version: int,
        auth: Optional[PublishAuthorization] = None,
        evidence: Optional[dict] = None,
        error_msg: str = "",
        publish_url: str = "",
        platform_post_id: str = "",
        screenshot_path: str = ""
    ) -> Tuple[bool, TargetStatus, str]:
        """
        执行带安全门禁的状态跃迁。
        返回: (success: bool, resulting_status: TargetStatus, reason: str)
        """
        # 1. 核心安全门禁: DRAFT_VERIFIED -> AUTHORIZED
        if next_status == TargetStatus.AUTHORIZED:
            if not auth:
                logger.warning(f"[SafetyGate] 拦截未授权发布请求 {task_id}:{target_id}")
                self._record_transition(task_id, target_id, current_status, TargetStatus.READY_TO_REVIEW, lease_token, claim_version, {"reason": "NO_AUTH_PROVIDED"})
                return False, TargetStatus.READY_TO_REVIEW, "NO_AUTH_PROVIDED"

            if not auth.is_valid():
                logger.warning(f"[SafetyGate] 授权令牌已过期或已使用 {task_id}:{target_id}")
                self._record_transition(task_id, target_id, current_status, TargetStatus.AUTHORIZATION_EXPIRED, lease_token, claim_version, {"reason": "AUTH_EXPIRED"})
                return False, TargetStatus.AUTHORIZATION_EXPIRED, "AUTH_EXPIRED"

            # 消费一次性授权 Nonce
            auth.consume()

        # 2. 执行数据库带 Fencing 更新
        ok = self.lease_mgr.update_target_status(
            task_id=task_id,
            target_id=target_id,
            status=next_status,
            lease_token=lease_token,
            claim_version=claim_version,
            publish_url=publish_url,
            platform_post_id=platform_post_id,
            receipt_screenshot=screenshot_path,
            error_message=error_msg
        )

        if not ok:
            return False, current_status, "FENCING_OR_LEASE_INVALID"

        # 3. 写入哈希防篡改审计日志
        payload = evidence or {}
        if error_msg:
            payload["error"] = error_msg
        if publish_url:
            payload["publish_url"] = publish_url
        if platform_post_id:
            payload["platform_post_id"] = platform_post_id

        self.audit.record_event(
            task_id=task_id,
            target_id=target_id,
            event_type=f"TARGET_TRANSITION_{current_status.value}_TO_{next_status.value}",
            payload=payload
        )

        return True, next_status, "SUCCESS"

    def _record_transition(self, task_id: str, target_id: str, from_st: TargetStatus, to_st: TargetStatus, token: str, version: int, payload: dict):
        self.lease_mgr.update_target_status(task_id, target_id, to_st, token, version)
        self.audit.record_event(task_id, target_id, f"TARGET_GATE_{from_st.value}_TO_{to_st.value}", payload)
