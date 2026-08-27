from abc import ABC, abstractmethod
from typing import Tuple, Dict, Any, Optional
from pathlib import Path

from ..models.policy import PlatformDescriptor, PLATFORM_DESCRIPTORS
from ..models.contract import TaskPackage, TargetSpec
from ..models.evidence import DraftVerificationRecord, PublishConfirmationRecord

class BasePlatformAdapter(ABC):
    """
    平台能力适配器基类 (支持 Operation-Level API / Browser / Hybrid 细粒度操作)
    """

    def __init__(self, descriptor: PlatformDescriptor):
        self.descriptor = descriptor

    @abstractmethod
    async def preflight(self, account_ref: str) -> Tuple[bool, str]:
        """三级健康检查：Session 有效性、账号发布权限、平台可用性"""
        pass

    @abstractmethod
    async def upload(self, media_path: str, target: TargetSpec) -> Dict[str, Any]:
        """上传视频二进制流，并强硬等待服务端转码/就绪"""
        pass

    @abstractmethod
    async def mutate(self, package: TaskPackage, target: TargetSpec) -> Dict[str, Any]:
        """表单与元数据填写：标题、描述、标签、声明、封面"""
        pass

    @abstractmethod
    async def verify_draft(self, package: TaskPackage, target: TargetSpec) -> DraftVerificationRecord:
        """独立草稿验收：DOM / 字段 / 封面 / 提交按钮状态交叉检查"""
        pass

    @abstractmethod
    async def submit_publish(self, target: TargetSpec) -> Dict[str, Any]:
        """触发最终发布 (API 请求或点击提交按钮)"""
        pass

    @abstractmethod
    async def confirm_published(self, target: TargetSpec, submit_receipt: Dict[str, Any]) -> PublishConfirmationRecord:
        """终态验收：提取 Post ID / URL / 视觉回执截图"""
        pass

    @abstractmethod
    async def reconcile_submission(self, account_ref: str, expected_title: str) -> Dict[str, Any]:
        """调和器探针：查询创作者后台或 API 对账稿件发布状态"""
        pass
