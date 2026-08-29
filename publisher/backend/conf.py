import os
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent.resolve()
DATA_DIR = Path(os.environ.get("PUBLISHER_DATA_DIR", BASE_DIR / "data"))

# 保证必要数据子目录存在 (cookiesFile 为文件，实际目录为 cookies)
for sub in ["db", "logs", "receipts", "incoming", "cache", "cookies"]:
    (DATA_DIR / sub).mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "db" / "publisher.db"
LOG_DIR = DATA_DIR / "logs"
RECEIPT_DIR = DATA_DIR / "receipts"
INCOMING_DIR = DATA_DIR / "incoming"

def _clamp_int(env_key: str, default: int, min_val: int, max_val: int) -> int:
    """环境变量整数钳制，防止 0/负值/超大值打爆资源池"""
    try:
        v = int(os.environ.get(env_key, str(default)))
    except (ValueError, TypeError):
        v = default
    return max(min_val, min(v, max_val))

# 默认网络代理 (针对 YouTube, X, TikTok) — 校验格式
_raw_proxy = os.environ.get("PUBLISHER_PROXY", "http://127.0.0.1:7890")
DEFAULT_PROXY = _raw_proxy if _raw_proxy.startswith(("http://", "https://", "socks5://")) else "http://127.0.0.1:7890"

# 调度器并发配置 (带钳制 1..5)
DEFAULT_UPLOAD_CONCURRENCY = _clamp_int("PUBLISHER_UPLOAD_CONCURRENCY", 3, 1, 5)
DEFAULT_UI_CONCURRENCY = 1 # UI 填表全局严格单并发，防止焦点冲突
DEFAULT_VERIFY_CONCURRENCY = _clamp_int("PUBLISHER_VERIFY_CONCURRENCY", 2, 1, 5)
MAX_TARGETS_PER_TASK = _clamp_int("PUBLISHER_MAX_TARGETS_PER_TASK", 2, 1, 8)

# 租约与授权默认时长 (钳制 60s..3600s)
DEFAULT_LEASE_DURATION_SEC = _clamp_int("PUBLISHER_LEASE_DURATION_SEC", 900, 60, 3600)
DEFAULT_AUTH_TTL_SEC = _clamp_int("PUBLISHER_AUTH_TTL_SEC", 900, 60, 3600)
