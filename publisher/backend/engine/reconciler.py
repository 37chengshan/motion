import logging
from typing import Optional, Tuple, Dict, Any

from ..models.state import TargetStatus
from ..models.contract import TargetSpec
from .state_machine import TargetStateMachine
from ..audit.hash_chain import HashChainedAuditLog

logger = logging.getLogger("reconciler")

class StateReconciler:
    """状态调和器：处理断网/崩溃/未定状态下的对账与自愈"""

    def __init__(self, state_machine: TargetStateMachine, audit_log: HashChainedAuditLog):
        self.sm = state_machine
        self.audit = audit_log

    async def reconcile_target(
        self,
        task_id: str,
        target_spec: TargetSpec,
        lease_token: str,
        claim_version: int,
        platform_adapter: Any,
        expected_title: str,
        from_status: TargetStatus = TargetStatus.UNKNOWN_OUTCOME
    ) -> Tuple[TargetStatus, str, Optional[Dict[str, str]]]:
        """
        对 UNKNOWN_OUTCOME 或 PUBLISHING 中断的子任务执行对账。
        返回: (final_status, reason, evidence_dict)
        """
        logger.info(f"[Reconciler] 启动平台对账 {task_id}:{target_spec.target_id} [{target_spec.platform}] (当前状态: {from_status.value})")

        # 标记进入对账中，准确记录前序状态
        self.sm.transition(
            task_id, target_spec.target_id,
            from_status, TargetStatus.RECONCILING,
            lease_token, claim_version,
            evidence={"expected_title": expected_title, "source_state": from_status.value}
        )

        try:
            # 调用平台专属查重与稿件检索探针
            reconcile_res = await platform_adapter.reconcile_submission(
                account_ref=target_spec.account_ref,
                expected_title=expected_title
            )

            is_found = reconcile_res.get("found", False)
            post_id = reconcile_res.get("post_id", "")
            publish_url = reconcile_res.get("publish_url", "")

            if is_found and (post_id or publish_url):
                # 平台已成功收录发布稿件 -> 确认为已发布
                logger.info(f"[Reconciler] 成功对账命中已发布稿件: {publish_url}")
                self.sm.transition(
                    task_id, target_spec.target_id,
                    TargetStatus.RECONCILING, TargetStatus.CONFIRMED,
                    lease_token, claim_version,
                    publish_url=publish_url,
                    platform_post_id=post_id,
                    evidence={"reconciled": True, "source": "creator_center_query"}
                )
                return TargetStatus.CONFIRMED, "RECONCILED_PUBLISHED", {"publish_url": publish_url, "post_id": post_id}

            elif reconcile_res.get("confirmed_absent", False):
                # 平台创作者后台确认无此稿件 -> 安全标记为未发布，允许后续重试
                logger.info(f"[Reconciler] 确认后台未提交成功，允许安全重试")
                self.sm.transition(
                    task_id, target_spec.target_id,
                    TargetStatus.RECONCILING, TargetStatus.NOT_PUBLISHED,
                    lease_token, claim_version,
                    evidence={"reconciled": True, "source": "confirmed_absent"}
                )
                return TargetStatus.NOT_PUBLISHED, "CONFIRMED_ABSENT", None

            else:
                # 状态不可判定 (如平台接口报错/网络持续不可达) -> 锁定为 BLOCKED，防止重复发布
                logger.warning(f"[Reconciler] 对账结果歧义，锁定为 BLOCKED")
                self.sm.transition(
                    task_id, target_spec.target_id,
                    TargetStatus.RECONCILING, TargetStatus.BLOCKED,
                    lease_token, claim_version,
                    error_msg="RECONCILIATION_AMBIGUOUS",
                    evidence=reconcile_res
                )
                return TargetStatus.BLOCKED, "RECONCILIATION_AMBIGUOUS", None

        except Exception as e:
            logger.error(f"[Reconciler] 对账执行异常: {e}")
            self.sm.transition(
                task_id, target_spec.target_id,
                TargetStatus.RECONCILING, TargetStatus.BLOCKED,
                lease_token, claim_version,
                error_msg=str(e)
            )
            return TargetStatus.BLOCKED, f"EXCEPTION: {str(e)}", None
