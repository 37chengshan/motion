import asyncio
import tempfile
from pathlib import Path
from datetime import datetime, timezone

from backend.models.contract import TaskPackage, TargetSpec
from backend.models.state import TargetStatus
from backend.daemon.lease_manager import LeaseManager
from backend.audit.hash_chain import HashChainedAuditLog
from backend.engine.state_machine import TargetStateMachine
from backend.engine.reconciler import StateReconciler
from backend.engine.scheduler import FairResourceScheduler
from backend.impl.bilibili.platform import BilibiliPlatformAdapter
from backend.impl.youtube.api_adapter import YouTubeAPIAdapter

class MockFailingAdapter(BilibiliPlatformAdapter):
    """模拟在提交发布后突然断网/崩溃的适配器"""
    async def submit_publish(self, target: TargetSpec):
        raise ConnectionResetError("网络在提交发布后突然中断 (Connection Reset)")

class MockConfirmedAdapter(BilibiliPlatformAdapter):
    """测试 double：对账命中已发布稿件（真实 ID 由测试提供，不在生产适配器伪造）"""
    async def reconcile_submission(self, account_ref: str, expected_title: str):
        return {"found": True, "post_id": "bv-test-ok-123", "publish_url": "https://www.bilibili.com/video/bv-test-ok-123"}

class MockAbsentAdapter(BilibiliPlatformAdapter):
    """模拟确认未提交成功的适配器"""
    async def reconcile_submission(self, account_ref: str, expected_title: str):
        return {"confirmed_absent": True}

def test_reconciler_published_recovery():
    async def _run():
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "test_rec.db"
            lease_mgr = LeaseManager(db_path)
            audit = HashChainedAuditLog(db_path)
            sm = TargetStateMachine(lease_mgr, audit)
            rec = StateReconciler(sm, audit)

            pkg = TaskPackage(
                task_id="task-recon-1",
                idempotency_key="idem-recon-1",
                canonical_content={"title": "测试网络中断自愈视频"},
                targets=[TargetSpec(target_id="t-recon-1", platform="bilibili", account_ref="default")]
            )
            ok, tok, ver, _ = lease_mgr.claim_task(pkg, worker_id="worker_A")

            # 模拟崩溃后的调和自愈（测试 double：真实响应解析在测试模块，生产适配器不伪造 post id）
            adapter = MockConfirmedAdapter()
            final_st, reason, evidence = await rec.reconcile_target(
                task_id="task-recon-1",
                target_spec=pkg.targets[0],
                lease_token=tok,
                claim_version=ver,
                platform_adapter=adapter,
                expected_title="测试网络中断自愈视频"
            )

            assert final_st == TargetStatus.CONFIRMED
            assert "RECONCILED_PUBLISHED" in reason
            assert evidence["publish_url"] is not None
            print("✓ Test 5: 调和器 UNKNOWN_OUTCOME 对账已发布自愈验证通过")

    asyncio.run(_run())

def test_reconciler_absent_recovery():
    async def _run():
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "test_rec2.db"
            lease_mgr = LeaseManager(db_path)
            audit = HashChainedAuditLog(db_path)
            sm = TargetStateMachine(lease_mgr, audit)
            rec = StateReconciler(sm, audit)

            pkg = TaskPackage(
                task_id="task-recon-2",
                idempotency_key="idem-recon-2",
                canonical_content={"title": "未发布测试"},
                targets=[TargetSpec(target_id="t-recon-2", platform="bilibili", account_ref="default")]
            )
            ok, tok, ver, _ = lease_mgr.claim_task(pkg, worker_id="worker_A")

            # 模拟确认未提交成功
            adapter = MockAbsentAdapter()
            final_st, reason, _ = await rec.reconcile_target(
                task_id="task-recon-2",
                target_spec=pkg.targets[0],
                lease_token=tok,
                claim_version=ver,
                platform_adapter=adapter,
                expected_title="未发布测试"
            )

            assert final_st == TargetStatus.NOT_PUBLISHED
            assert "CONFIRMED_ABSENT" in reason
            print("✓ Test 6: 调和器确认后台无稿件安全回滚至 NOT_PUBLISHED 验证通过")

    asyncio.run(_run())

if __name__ == "__main__":
    test_reconciler_published_recovery()
    test_reconciler_absent_recovery()
