import logging
import re
import uuid
from datetime import datetime, timezone
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger("policy")
@dataclass
class PlatformConstraints:
    max_title_len: int
    max_desc_len: int
    max_video_size_bytes: int
    max_duration_sec: float
    min_duration_sec: float = 3.0
    aspect_ratios: list[str] = field(default_factory=lambda: ["16:9", "9:16", "3:4", "1:1"])
    forbidden_title_regex: str = ""
    supports_schedule: bool = True
    supports_dual_cover: bool = False
    requires_ai_declaration: bool = False

@dataclass
class PlatformDescriptor:
    platform_id: int
    platform_key: str
    platform_name: str
    constraints: PlatformConstraints
    providers: dict[str, str] = field(default_factory=dict) # e.g. {"upload": "api", "metadata": "api", "verify": "api"}

# 平台强约束与能力描述符注册表
PLATFORM_DESCRIPTORS: dict[str, PlatformDescriptor] = {
    "bilibili": PlatformDescriptor(
        platform_id=5,
        platform_key="bilibili",
        platform_name="B站",
        constraints=PlatformConstraints(
            max_title_len=80,
            max_desc_len=2000,
            max_video_size_bytes=16 * 1024 * 1024 * 1024, # 16GB
            max_duration_sec=14400.0, # 4 小时
            aspect_ratios=["16:9", "4:3", "9:16"],
            # B站标题禁止非法 emoji (非BMP字符) 和 HTML 危险字符 (<>"'&)
            forbidden_title_regex=r'[\u2600-\u27bf\ufe00-\ufe0f\u200d\u20e3\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufff0-\uffff\U0001f000-\U0001faff<>"\'&]',
            supports_schedule=True,
            supports_dual_cover=True,
            requires_ai_declaration=True,
        ),
        providers={"upload": "browser", "metadata": "browser", "cover": "browser", "verify": "browser"},
    ),
    "xiaohongshu": PlatformDescriptor(
        platform_id=1,
        platform_key="xiaohongshu",
        platform_name="小红书",
        constraints=PlatformConstraints(
            max_title_len=20,
            max_desc_len=1000,
            max_video_size_bytes=4 * 1024 * 1024 * 1024, # 4GB
            max_duration_sec=900.0, # 15 分钟
            aspect_ratios=["3:4", "9:16", "1:1"],
            supports_schedule=True,
            supports_dual_cover=False,
            requires_ai_declaration=True,
        ),
        providers={"upload": "browser", "metadata": "browser", "cover": "browser", "verify": "browser"},
    ),
    "douyin": PlatformDescriptor(
        platform_id=3,
        platform_key="douyin",
        platform_name="抖音",
        constraints=PlatformConstraints(
            max_title_len=1000, # 抖音将标题与正文合并
            max_desc_len=1000,
            max_video_size_bytes=4 * 1024 * 1024 * 1024,
            max_duration_sec=900.0, # 15:00 边界，严格拦截 >900.0s
            aspect_ratios=["9:16", "16:9", "1:1"],
            supports_schedule=True,
            supports_dual_cover=True, # 横竖版封面
            requires_ai_declaration=True,
        ),
        providers={"upload": "browser", "metadata": "browser", "cover": "browser", "verify": "browser"},
    ),
    "kuaishou": PlatformDescriptor(
        platform_id=4,
        platform_key="kuaishou",
        platform_name="快手",
        constraints=PlatformConstraints(
            max_title_len=500,
            max_desc_len=500,
            max_video_size_bytes=4 * 1024 * 1024 * 1024,
            max_duration_sec=600.0, # 10 分钟
            aspect_ratios=["9:16", "16:9"],
            supports_schedule=True,
            supports_dual_cover=False,
            requires_ai_declaration=True,
        ),
        providers={"upload": "browser", "metadata": "browser", "cover": "browser", "verify": "browser"},
    ),
    "channels": PlatformDescriptor(
        platform_id=2,
        platform_key="channels",
        platform_name="微信视频号",
        constraints=PlatformConstraints(
            max_title_len=1000,
            max_desc_len=1000,
            max_video_size_bytes=2 * 1024 * 1024 * 1024, # 2GB
            max_duration_sec=1800.0, # 30 分钟
            aspect_ratios=["9:16", "16:9", "3:4"],
            supports_schedule=True,
            supports_dual_cover=False,
            requires_ai_declaration=True,
        ),
        providers={"upload": "browser", "metadata": "browser", "cover": "browser", "verify": "browser"},
    ),
    "tiktok": PlatformDescriptor(
        platform_id=7,
        platform_key="tiktok",
        platform_name="TikTok",
        constraints=PlatformConstraints(
            max_title_len=2200,
            max_desc_len=2200,
            max_video_size_bytes=4 * 1024 * 1024 * 1024,
            max_duration_sec=600.0, # 10 分钟
            aspect_ratios=["9:16", "16:9", "1:1"],
            supports_schedule=True,
            supports_dual_cover=False,
            requires_ai_declaration=True,
        ),
        providers={"upload": "browser", "metadata": "browser", "cover": "browser", "verify": "browser"},
    ),
    "x": PlatformDescriptor(
        platform_id=21,
        platform_key="x",
        platform_name="X / Twitter",
        constraints=PlatformConstraints(
            max_title_len=280,
            max_desc_len=280,
            max_video_size_bytes=512 * 1024 * 1024, # 512MB
            max_duration_sec=140.0, # 标准账号 2分20秒
            aspect_ratios=["16:9", "9:16", "1:1"],
            supports_schedule=False,
            supports_dual_cover=False,
            requires_ai_declaration=False,
        ),
        providers={"upload": "api", "metadata": "api", "verify": "api"},
    ),
    "youtube": PlatformDescriptor(
        platform_id=8,
        platform_key="youtube",
        platform_name="YouTube",
        constraints=PlatformConstraints(
            max_title_len=100,
            max_desc_len=5000,
            max_video_size_bytes=256 * 1024 * 1024 * 1024, # 256GB
            max_duration_sec=43200.0, # 12 小时
            aspect_ratios=["16:9", "9:16"],
            supports_schedule=True,
            supports_dual_cover=False,
            requires_ai_declaration=True,
        ),
        providers={"upload": "api", "metadata": "api", "verify": "api"},
    ),
}

@dataclass
class PublishAuthorization:
    authorization_id: str
    task_id: str
    target_id: str
    authorized_at: str
    authorized_by: str        # "auto_policy" | "operator_alice" | "agent_claude"
    expires_at: str           # ISO-8601 格式时间戳
    scope: str = "single_target" # "single_target" | "full_task"
    nonce: str = field(default_factory=lambda: uuid.uuid4().hex)
    is_consumed: bool = False

    def _parse_expires(self) -> Optional[datetime]:
        try:
            # 兼容带时区与不带时区的 ISO-8601
            dt = datetime.fromisoformat(self.expires_at.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except Exception:
            return None

    def is_valid(self) -> bool:
        if self.is_consumed:
            return False
        exp = self._parse_expires()
        if exp is None:
            return False
        return datetime.now(timezone.utc) < exp

    def consume(self, db_path: Optional[Path] = None) -> bool:
        """消费 Nonce：内存标记 + 可选持久化到 publish_authorizations 表防重启重放"""
        if not self.is_valid():
            return False
        self.is_consumed = True
        try:
            import sqlite3
            _db = db_path
            if _db is None:
                try:
                    from ..conf import DB_PATH as _DEFAULT_DB
                    _db = Path(_DEFAULT_DB)
                except Exception:
                    _db = None
            if _db is not None and Path(_db).exists():
                conn = sqlite3.connect(str(_db), timeout=5.0)
                try:
                    conn.execute("UPDATE publish_authorizations SET is_consumed=1 WHERE nonce=? AND is_consumed=0", (self.nonce,))
                    conn.commit()
                finally:
                    conn.close()
        except Exception as e:
            logger.warning(f"[Policy] 持久化 consume 失败 nonce={self.nonce}: {e}")
        return True

def sanitize_bilibili_title(title: str) -> str:
    """清洗 B 站标题，剔除非法 emoji 与危险 HTML 实体"""
    forbidden_re = re.compile(PLATFORM_DESCRIPTORS["bilibili"].constraints.forbidden_title_regex)
    return forbidden_re.sub("", title)
