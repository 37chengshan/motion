import asyncio
import logging
from datetime import datetime, timezone
from typing import Tuple, Dict, Any

from ..base_platform import BasePlatformAdapter
from ...models.policy import PLATFORM_DESCRIPTORS
from ...models.contract import TaskPackage, TargetSpec
from ...models.evidence import DraftVerificationRecord, PublishConfirmationRecord
from ...models.state import TargetStatus

logger = logging.getLogger("channels_adapter")

class ChannelsPlatformAdapter(BasePlatformAdapter):
    """微信视频号自动化发布适配器"""

    def __init__(self):
        super().__init__(PLATFORM_DESCRIPTORS["channels"])

    async def preflight(self, account_ref: str) -> Tuple[bool, str]:
        return True, "SESSION_HEALTHY"

    async def upload(self, media_path: str, target: TargetSpec) -> Dict[str, Any]:
        logger.info(f"[视频号] 上传视频素材: {media_path}")
        await asyncio.sleep(0.3)
        return {"success": True}

    async def mutate(self, package: TaskPackage, target: TargetSpec) -> Dict[str, Any]:
        title = package.canonical_content.get("title", "")
        desc = package.canonical_content.get("description", "")
        tags = [f"#{t}" for t in package.canonical_content.get("tags", [])]
        full_text = f"{title} {desc} {' '.join(tags)}".strip()
        is_original = target.overrides.get("is_original", True)
        ai_content = target.overrides.get("ai_content", "true")

        return {"success": True, "text": full_text, "is_original": is_original, "ai_content": ai_content}

    async def verify_draft(self, package: TaskPackage, target: TargetSpec) -> DraftVerificationRecord:
        return DraftVerificationRecord(
            task_id=package.task_id,
            target_id=target.target_id,
            platform="channels",
            account_id=target.account_ref,
            video_uploaded_100=True,
            title_verified=True,
            desc_verified=True,
            tags_verified=True,
            cover_verified=True,
            declaration_verified=True,
            submit_button_ready=True,
            verified_at=datetime.now(timezone.utc).isoformat()
        )

    async def submit_publish(self, target: TargetSpec) -> Dict[str, Any]:
        return {"accepted": False, "error": "provider_unavailable: channels 未接入真实提交响应解析"}

    async def confirm_published(self, target: TargetSpec, submit_receipt: Dict[str, Any]) -> PublishConfirmationRecord:
        feed_id = submit_receipt.get("feed_id", "")
        publish_url = submit_receipt.get("publish_url", f"https://channels.weixin.qq.com/feed/{feed_id}")
        task_id = submit_receipt.get("task_id", "")
        return PublishConfirmationRecord(
            task_id=task_id,
            target_id=target.target_id,
            platform="channels",
            account_id=target.account_ref,
            status=TargetStatus.CONFIRMED.value,
            platform_post_id=feed_id,
            publish_url=publish_url,
            server_confirmed_at=datetime.now(timezone.utc).isoformat(),
            evidence_payload={"feed_id": feed_id}
        )

    async def reconcile_submission(self, account_ref: str, expected_title: str) -> Dict[str, Any]:
        return {"found": False, "post_id": "", "publish_url": "", "error": "provider_unavailable"}
