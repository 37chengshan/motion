import os
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent.resolve()
DATA_DIR = Path(os.environ.get("PUBLISHER_DATA_DIR", BASE_DIR / "data"))

# 保证必要数据子目录存在
for sub in ["db", "logs", "receipts", "incoming", "cache", "cookiesFile"]:
    (DATA_DIR / sub).mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "db" / "publisher.db"
LOG_DIR = DATA_DIR / "logs"
RECEIPT_DIR = DATA_DIR / "receipts"
INCOMING_DIR = DATA_DIR / "incoming"

# 默认网络代理 (针对 YouTube, X, TikTok)
DEFAULT_PROXY = os.environ.get("PUBLISHER_PROXY", "http://127.0.0.1:7890")

# 调度器并发配置
DEFAULT_UPLOAD_CONCURRENCY = int(os.environ.get("PUBLISHER_UPLOAD_CONCURRENCY", "3"))
DEFAULT_UI_CONCURRENCY = 1 # UI 填表全局严格单并发，防止焦点冲突
DEFAULT_VERIFY_CONCURRENCY = int(os.environ.get("PUBLISHER_VERIFY_CONCURRENCY", "2"))
MAX_TARGETS_PER_TASK = int(os.environ.get("PUBLISHER_MAX_TARGETS_PER_TASK", "2"))

# 租约与授权默认时长
DEFAULT_LEASE_DURATION_SEC = 900 # 15 分钟
DEFAULT_AUTH_TTL_SEC = 900       # 15 分钟
