from abc import ABC, abstractmethod
from typing import List, Optional
from pathlib import Path

from ..models.contract import TaskPackage

class BaseTransport(ABC):
    @abstractmethod
    async def fetch_pending_packages(self) -> List[TaskPackage]:
        """拉取或探测待处理的任务包"""
        pass

    @abstractmethod
    async def acknowledge_package(self, task_id: str, success: bool, payload: dict) -> bool:
        """任务处理完成后的状态回写与确认"""
        pass
