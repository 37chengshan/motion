import asyncio
import logging
from typing import Dict, Any, Optional

from ..conf import (
    DEFAULT_UPLOAD_CONCURRENCY,
    DEFAULT_UI_CONCURRENCY,
    DEFAULT_VERIFY_CONCURRENCY,
    MAX_TARGETS_PER_TASK
)
from ..models.contract import TaskPackage, TargetSpec
from ..models.state import TaskStatus, TargetStatus
from ..models.policy import PublishAuthorization
from .state_machine import TargetStateMachine
from .reconciler import StateReconciler
from ..daemon.lease_manager import LeaseManager

logger = logging.getLogger("scheduler")

class FairResourceScheduler:
    """三池分离与任务级预算公平调度器"""

    def __init__(
        self,
        lease_manager: LeaseManager,
        state_machine: TargetStateMachine,
        reconciler: StateReconciler,
        upload_concurrency: int = DEFAULT_UPLOAD_CONCURRENCY,
        ui_concurrency: int = DEFAULT_UI_CONCURRENCY,
        verify_concurrency: int = DEFAULT_VERIFY_CONCURRENCY
    ):
        self.lease_mgr = lease_manager
        self.sm = state_machine
        self.reconciler = reconciler

        # 核心资源池信号量
        self.upload_pool = asyncio.Semaphore(upload_concurrency)
        self.ui_pool = asyncio.Semaphore(ui_concurrency) # 严格设为 1
        self.verify_pool = asyncio.Semaphore(verify_concurrency)

    async def execute_task_package(
        self,
        package: TaskPackage,
        lease_token: str,
        claim_version: int,
        platform_adapters: Dict[str, Any],
        authorizations: Optional[Dict[str, PublishAuthorization]] = None
    ) -> Dict[str, TargetStatus]:
        """
        按任务级公平配额并发执行 TaskPackage 下的所有 Target 子任务
        """
        results = {}
        auth_map = authorizations or {}
        max_parallel = min(package.max_parallel_targets or MAX_TARGETS_PER_TASK, len(package.targets))
        task_semaphore = asyncio.Semaphore(max_parallel)

        async def _run_target_guarded(target: TargetSpec):
            async with task_semaphore:
                adapter = platform_adapters.get(target.platform)
                if not adapter:
                    logger.error(f"[Scheduler] 未找到平台适配器: {target.platform}")
                    self.sm.transition(
                        package.task_id, target.target_id,
                        TargetStatus.CLAIMED, TargetStatus.FAILED,
                        lease_token, claim_version,
                        error_msg=f"PLATFORM_ADAPTER_MISSING: {target.platform}"
                    )
                    return target.target_id, TargetStatus.FAILED

                auth = auth_map.get(target.target_id)
                status = await self._execute_target_pipeline(
                    package=package,
                    target=target,
                    lease_token=lease_token,
                    claim_version=claim_version,
                    adapter=adapter,
                    auth=auth
                )
                return target.target_id, status

        # 并发派发子任务
        tasks = [_run_target_guarded(t) for t in package.targets]
        executed_results = await asyncio.gather(*tasks, return_exceptions=True)

        for res in executed_results:
            if isinstance(res, Exception):
                logger.error(f"[Scheduler] 任务执行发生未捕获异常: {res}")
            elif isinstance(res, tuple):
                t_id, st = res
                results[t_id] = st

        # 计算并更新 Task 顶层状态
        final_statuses = list(results.values())
        if all(s == TargetStatus.CONFIRMED for s in final_statuses):
            task_final = TaskStatus.COMPLETED
        elif any(s == TargetStatus.CONFIRMED for s in final_statuses):
            task_final = TaskStatus.PARTIAL_SUCCESS
        elif all(s in [TargetStatus.FAILED, TargetStatus.BLOCKED] for s in final_statuses):
            task_final = TaskStatus.FAILED
        else:
            task_final = TaskStatus.PROCESSING

        self.lease_mgr.update_task_status(package.task_id, task_final, lease_token, claim_version)
        return results

    async def _execute_target_pipeline(
        self,
        package: TaskPackage,
        target: TargetSpec,
        lease_token: str,
        claim_version: int,
        adapter: Any,
        auth: Optional[PublishAuthorization]
    ) -> TargetStatus:
        """执行单一 Target 子任务的完整 7 步生命周期管道"""
        task_id = package.task_id
        target_id = target.target_id
        title = package.canonical_content.get("title", "")
        current_status = TargetStatus.CLAIMED

        try:
            # 1. PREFLIGHT: 账号与平台健康预检
            self.sm.transition(task_id, target_id, current_status, TargetStatus.PREFLIGHT, lease_token, claim_version)
            current_status = TargetStatus.PREFLIGHT
            preflight_ok, preflight_msg = await adapter.preflight(target.account_ref)
            if not preflight_ok:
                self.sm.transition(task_id, target_id, current_status, TargetStatus.FAILED, lease_token, claim_version, error_msg=preflight_msg)
                return TargetStatus.FAILED

            # 2. UPLOADING: 并行上传视频流
            self.sm.transition(task_id, target_id, current_status, TargetStatus.UPLOADING, lease_token, claim_version)
            current_status = TargetStatus.UPLOADING
            video_asset = next((a for a in package.assets if a.type == "video"), None)
            video_path = video_asset.local_path if video_asset else ""

            async with self.upload_pool:
                upload_res = await adapter.upload(video_path, target)
                if not upload_res.get("success"):
                    self.sm.transition(task_id, target_id, current_status, TargetStatus.FAILED, lease_token, claim_version, error_msg=upload_res.get("error", "UPLOAD_FAILED"))
                    return TargetStatus.FAILED

            # 3. MUTATING: 串行 UI 填表/配置
            self.sm.transition(task_id, target_id, current_status, TargetStatus.MUTATING, lease_token, claim_version)
            current_status = TargetStatus.MUTATING
            async with self.ui_pool:
                mutate_res = await adapter.mutate(package, target)
                if not mutate_res.get("success"):
                    self.sm.transition(task_id, target_id, current_status, TargetStatus.FAILED, lease_token, claim_version, error_msg=mutate_res.get("error", "MUTATE_FAILED"))
                    return TargetStatus.FAILED

            # 4. DRAFT VERIFYING: 独立草稿验收
            self.sm.transition(task_id, target_id, current_status, TargetStatus.DRAFT_READY, lease_token, claim_version)
            current_status = TargetStatus.DRAFT_READY
            self.sm.transition(task_id, target_id, current_status, TargetStatus.VERIFYING_DRAFT, lease_token, claim_version)
            current_status = TargetStatus.VERIFYING_DRAFT

            async with self.verify_pool:
                draft_record = await adapter.verify_draft(package, target)
                if not draft_record.is_fully_verified:
                    self.sm.transition(task_id, target_id, current_status, TargetStatus.FAILED, lease_token, claim_version, error_msg="DRAFT_VERIFICATION_FAILED")
                    return TargetStatus.FAILED

            self.sm.transition(task_id, target_id, current_status, TargetStatus.DRAFT_VERIFIED, lease_token, claim_version, evidence=draft_record.to_dict())
            current_status = TargetStatus.DRAFT_VERIFIED

            # 5. SAFETY GATE & AUTHORIZATION: 发布授权检查
            if target.publish_policy == "draft_only" or not auth:
                # 显式停在草稿就绪状态
                self.sm.transition(task_id, target_id, current_status, TargetStatus.READY_TO_REVIEW, lease_token, claim_version)
                return TargetStatus.READY_TO_REVIEW

            ok, resulting_st, reason = self.sm.transition(
                task_id, target_id, current_status, TargetStatus.AUTHORIZED,
                lease_token, claim_version, auth=auth
            )
            if not ok:
                return resulting_st
            current_status = TargetStatus.AUTHORIZED

            # 6. PUBLISHING: 正式提交发布 (API 或 UI)
            self.sm.transition(task_id, target_id, current_status, TargetStatus.PUBLISHING, lease_token, claim_version)
            current_status = TargetStatus.PUBLISHING
            submit_res = None
            try:
                # 若平台走 UI 提交则占 ui_pool，若走 API 则直接调用
                if adapter.descriptor.providers.get("upload") == "browser":
                    async with self.ui_pool:
                        submit_res = await adapter.submit_publish(target)
                else:
                    submit_res = await adapter.submit_publish(target)
            except Exception as publish_exc:
                logger.error(f"[Scheduler] 提交过程异常，进入调和器对账: {publish_exc}")
                st, _, _ = await self.reconciler.reconcile_target(
                    task_id=task_id,
                    target_spec=target,
                    lease_token=lease_token,
                    claim_version=claim_version,
                    platform_adapter=adapter,
                    expected_title=title,
                    from_status=current_status
                )
                return st
            if not submit_res.get("accepted"):
                self.sm.transition(task_id, target_id, current_status, TargetStatus.FAILED, lease_token, claim_version, error_msg=submit_res.get("error", "SUBMIT_REJECTED"))
                return TargetStatus.FAILED

            submit_res["task_id"] = task_id
            self.sm.transition(task_id, target_id, current_status, TargetStatus.SUBMIT_ACCEPTED, lease_token, claim_version)
            current_status = TargetStatus.SUBMIT_ACCEPTED

            # 7. CONFIRMING & VERIFICATION: 终态确认 (拉取真实 Post ID 与 URL)
            self.sm.transition(task_id, target_id, current_status, TargetStatus.CONFIRMING, lease_token, claim_version)
            current_status = TargetStatus.CONFIRMING
            async with self.verify_pool:
                confirm_record = await adapter.confirm_published(target, submit_res)

            if confirm_record and confirm_record.status == TargetStatus.CONFIRMED.value:
                self.sm.transition(
                    task_id, target_id, current_status, TargetStatus.CONFIRMED,
                    lease_token, claim_version,
                    publish_url=confirm_record.publish_url,
                    platform_post_id=confirm_record.platform_post_id,
                    screenshot_path=confirm_record.receipt_screenshot_path,
                    evidence=confirm_record.to_dict()
                )
                return TargetStatus.CONFIRMED
            else:
                # 无法确认终态 -> 交由调和器
                st, _, _ = await self.reconciler.reconcile_target(
                    task_id=task_id,
                    target_spec=target,
                    lease_token=lease_token,
                    claim_version=claim_version,
                    platform_adapter=adapter,
                    expected_title=title,
                    from_status=current_status
                )
                return st

        except Exception as e:
            logger.exception(f"[Scheduler] 子任务处理未知异常 {task_id}:{target_id} - {e}")
            self.sm.transition(task_id, target_id, current_status, TargetStatus.FAILED, lease_token, claim_version, error_msg=str(e))
            return TargetStatus.FAILED
