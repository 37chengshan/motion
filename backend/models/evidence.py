from dataclasses import dataclass, field, asdict
from typing import Optional

@dataclass
class DraftVerificationRecord:
    task_id: str
    target_id: str
    platform: str
    account_id: str
    video_uploaded_100: bool
    title_verified: bool
    desc_verified: bool
    tags_verified: bool
    cover_verified: bool
    declaration_verified: bool
    submit_button_ready: bool
    verified_at: str
    screenshot_path: str = ""
    notes: str = ""

    @property
    def is_fully_verified(self) -> bool:
        return (
            self.video_uploaded_100
            and self.title_verified
            and self.desc_verified
            and self.tags_verified
            and self.cover_verified
            and self.declaration_verified
            and self.submit_button_ready
        )

    def to_dict(self) -> dict:
        d = asdict(self)
        d["is_fully_verified"] = self.is_fully_verified
        return d

@dataclass
class PublishConfirmationRecord:
    task_id: str
    target_id: str
    platform: str
    account_id: str
    status: str # e.g. "CONFIRMED"
    platform_post_id: str
    publish_url: str
    receipt_screenshot_path: str = ""
    server_confirmed_at: str = ""
    evidence_payload: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)
