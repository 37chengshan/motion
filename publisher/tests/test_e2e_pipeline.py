import asyncio
import json
import tempfile
from pathlib import Path

from publisher.backend.models.contract import TaskPackage, AssetSpec, TargetSpec
from publisher.backend.models.state import TaskStatus, TargetStatus
from publisher.backend.daemon.publisher_daemon import MasterPublisherDaemon
from publisher.backend.transport.local_watch_adapter import LocalWatchAdapter

def test_full_e2e_publishing_pipeline():
    async def _run():
        with tempfile.TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            incoming_dir = base_dir / "incoming"
            incoming_dir.mkdir(parents=True, exist_ok=True)
            db_path = base_dir / "e2e_publisher.db"

            # 1. 构造一个包含 8 个平台的综合任务包
            task_dir = incoming_dir / "job-e2e-001"
            task_dir.mkdir(parents=True, exist_ok=True)

            video_file = task_dir / "ai_news_0826.mp4"
            video_file.write_bytes(b"FAKE_VIDEO_CONTENT_DATA_STREAM")

            cover_file = task_dir / "cover.jpg"
            cover_file.write_bytes(b"FAKE_COVER_IMAGE_DATA")

            manifest_data = {
                "package_version": "1.1.0",
                "task_id": "job-e2e-001",
                "idempotency_key": "idem-e2e-001",
                "producer": "windows_ai_news_producer",
                "canonical_content": {
                    "title": "8月26日全球 AI 早报：大模型与开源工具速递",
                    "description": "今日核心看点：1. 模型突破 2. 开源框架更新",
                    "tags": ["人工智能", "AI资讯", "开源项目", "科技前沿"],
                    "category": "科技",
                    "is_original": True
                },
                "assets": [
                    {
                        "asset_id": "vid-1",
                        "type": "video",
                        "filename": "ai_news_0826.mp4",
                        "size_bytes": len(video_file.read_bytes()),
                        "duration": 65.0
                    },
                    {
                        "asset_id": "cov-1",
                        "type": "cover",
                        "filename": "cover.jpg",
                        "size_bytes": len(cover_file.read_bytes())
                    }
                ],
                "targets": [
                    {"target_id": "t-bili", "platform": "bilibili", "account_ref": "default", "publish_policy": "publish"},
                    {"target_id": "t-xhs", "platform": "xiaohongshu", "account_ref": "default", "publish_policy": "publish"},
                    {"target_id": "t-dy", "platform": "douyin", "account_ref": "default", "publish_policy": "publish"},
                    {"target_id": "t-ks", "platform": "kuaishou", "account_ref": "default", "publish_policy": "publish"},
                    {"target_id": "t-chan", "platform": "channels", "account_ref": "default", "publish_policy": "publish"},
                    {"target_id": "t-tt", "platform": "tiktok", "account_ref": "default", "publish_policy": "publish"},
                    {"target_id": "t-x", "platform": "x", "account_ref": "default", "publish_policy": "publish"},
                    {"target_id": "t-yt", "platform": "youtube", "account_ref": "default", "publish_policy": "publish"},
                ]
            }

            (task_dir / "manifest.json").write_text(json.dumps(manifest_data, ensure_ascii=False, indent=2), encoding="utf-8")

            # 2. 启动 Master Publisher Daemon 并执行单轮轮询
            daemon = MasterPublisherDaemon(
                worker_id="test_mac_worker_01",
                db_path=db_path
            )
            # 将 transport 替换为测试目录
            daemon.transports = [LocalWatchAdapter(incoming_dir=incoming_dir)]

            processed = await daemon.poll_and_process_once()
            assert processed == 1

            # 3. 校验回执 receipt.json 是否生成
            receipt_file = task_dir / "receipt.json"
            assert receipt_file.exists()
            receipt_content = json.loads(receipt_file.read_text(encoding="utf-8"))
            assert receipt_content["task_id"] == "job-e2e-001"
            assert receipt_content["success"] is True
            target_res = receipt_content["payload"]["target_results"]

            # 验证全平台全部终态 CONFIRMED
            for t_id in ["t-bili", "t-xhs", "t-dy", "t-ks", "t-chan", "t-tt", "t-x", "t-yt"]:
                assert target_res[t_id] == TargetStatus.CONFIRMED.value

            # 4. 验证哈希链审计完整无破坏
            chain_ok, event_count, err = daemon.audit_log.verify_chain_integrity()
            assert chain_ok is True
            assert event_count > 10 # 包含了全流程的状态跃迁事件
            print(f"✓ Test 7: 端到端全平台分发流水线 (8 大平台) 及审计链 ({event_count} 个防篡改事件) 验证 100% 通过！")

    asyncio.run(_run())

if __name__ == "__main__":
    test_full_e2e_publishing_pipeline()
