import hashlib
import json
import uuid
from datetime import datetime, timezone
from dataclasses import dataclass, field, asdict
from typing import Optional

@dataclass
class AssetSpec:
    asset_id: str
    type: str                # "video" | "cover" | "cover_landscape" | "cover_portrait"
    filename: str
    sha256: str = ""
    size_bytes: int = 0
    mime: str = ""
    width: int = 0
    height: int = 0
    duration: float = 0.0
    local_path: str = ""

@dataclass
class TargetSpec:
    target_id: str           # 每个目标平台独立的子任务 ID
    platform: str            # "bilibili" | "xiaohongshu" | "douyin" | "kuaishou" | "channels" | "tiktok" | "x" | "youtube"
    account_ref: str         # 账号 ID 或标签路由，如 "default", "tag:ai_news", "account:1"
    overrides: dict = field(default_factory=dict) # 平台特定字段覆盖
    schedule_time: str = ""  # ISO-8601 或 "yyyy-MM-dd HH:mm:ss", 空表示立即
    publish_policy: str = "publish" # "draft_only" | "publish"

@dataclass
class TaskPackage:
    package_version: str = "1.1.0"
    task_id: str = field(default_factory=lambda: f"task-{uuid.uuid4().hex[:12]}")
    idempotency_key: str = field(default_factory=lambda: f"idem-{uuid.uuid4().hex}")
    dedupe_key: str = ""
    producer: str = "windows_producer"
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    expires_at: str = ""
    priority: int = 5                # 1(最低) - 10(最高)
    deadline: str = ""
    max_parallel_targets: int = 2   # 单任务最大并发子任务配额
    assets: list[AssetSpec] = field(default_factory=list)
    canonical_content: dict = field(default_factory=dict) # title, description, tags, category, originality, ai_declaration
    targets: list[TargetSpec] = field(default_factory=list)

    def calculate_dedupe_key(self) -> str:
        """根据内容、资产哈希、目标平台计算内容去重键"""
        raw_elements = {
            "title": self.canonical_content.get("title", ""),
            "description": self.canonical_content.get("description", ""),
            "assets_hashes": sorted([a.sha256 for a in self.assets if a.sha256]),
            "targets": sorted([f"{t.platform}:{t.account_ref}" for t in self.targets]),
        }
        raw_json = json.dumps(raw_elements, sort_keys=True, ensure_ascii=False)
        self.dedupe_key = hashlib.sha256(raw_json.encode("utf-8")).hexdigest()
        return self.dedupe_key

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "TaskPackage":
        assets = [AssetSpec(**a) for a in data.get("assets", [])]
        targets = [TargetSpec(**t) for t in data.get("targets", [])]
        pkg = cls(
            package_version=data.get("package_version", "1.1.0"),
            task_id=data.get("task_id", f"task-{uuid.uuid4().hex[:12]}"),
            idempotency_key=data.get("idempotency_key", f"idem-{uuid.uuid4().hex}"),
            dedupe_key=data.get("dedupe_key", ""),
            producer=data.get("producer", "producer"),
            created_at=data.get("created_at", datetime.now(timezone.utc).isoformat()),
            expires_at=data.get("expires_at", ""),
            priority=data.get("priority", 5),
            deadline=data.get("deadline", ""),
            max_parallel_targets=data.get("max_parallel_targets", 2),
            assets=assets,
            canonical_content=data.get("canonical_content", {}),
            targets=targets,
        )
        if not pkg.dedupe_key:
            pkg.calculate_dedupe_key()
        return pkg
