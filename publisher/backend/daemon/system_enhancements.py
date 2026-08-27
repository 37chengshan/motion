import asyncio
import ctypes
import logging
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

logger = logging.getLogger("system_enhancements")

class MacPowerGuard:
    """
    Mac 电源与休眠管理保护器。
    在任务执行期间通过 `caffeinate` 或 macOS IOKit 声明断言，
    防止 Mac 息屏、盒盖或进入 App Nap 导致网络中断与浏览器假死。
    """

    def __init__(self):
        self._caffeinate_proc: Optional[subprocess.Popen] = None

    def prevent_sleep(self, reason: str = "Publisher Node active job"):
        """阻止系统休眠与空闲睡眠"""
        if sys.platform != "darwin":
            return
        if self._caffeinate_proc is None or self._caffeinate_proc.poll() is not None:
            try:
                # -d: 阻止显示器休眠, -i: 阻止系统空闲休眠, -m: 阻止磁盘休眠, -s: 阻止系统睡眠
                self._caffeinate_proc = subprocess.Popen(
                    ["caffeinate", "-dims", "-w", str(os.getpid())],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
                logger.info(f"[PowerGuard] 已启用 macOS 休眠阻断保护 (caffeinate PID={self._caffeinate_proc.pid}): {reason}")
            except Exception as e:
                logger.warning(f"[PowerGuard] 启动 caffeinate 失败: {e}")

    def allow_sleep(self):
        """任务结束后恢复系统正常休眠策略"""
        if self._caffeinate_proc and self._caffeinate_proc.poll() is None:
            try:
                self._caffeinate_proc.terminate()
                self._caffeinate_proc.wait(timeout=2)
                logger.info("[PowerGuard] 已释放 macOS 休眠阻断保护，恢复节能策略")
            except Exception:
                pass
            self._caffeinate_proc = None

class MediaStorageGC:
    """
    素材缓存与垃圾回收器 (GC)。
    防止每日 AI 早晚报与搬运大视频撑爆 Mac 本地 SSD 磁盘。
    """

    def __init__(self, incoming_dir: Path, retention_days: int = 3, max_dir_size_gb: float = 20.0):
        self.incoming_dir = incoming_dir
        self.retention_days = retention_days
        self.max_dir_size_gb = max_dir_size_gb

    def run_cleanup(self) -> int:
        """清理已完成且超过保留期限的任务目录与临时大文件"""
        if not self.incoming_dir.exists():
            return 0

        cleaned_count = 0
        now = datetime.now(timezone.utc)
        cutoff_time = now - timedelta(days=self.retention_days)

        for sub in self.incoming_dir.iterdir():
            if not sub.is_dir():
                continue

            receipt_file = sub / "receipt.json"
            # 只有已生成回执（处理完成）的目录才纳入自动清理
            if receipt_file.exists():
                mtime = datetime.fromtimestamp(sub.stat().st_mtime, tz=timezone.utc)
                if mtime < cutoff_time:
                    try:
                        shutil.rmtree(sub)
                        logger.info(f"[StorageGC] 已自动清理已完成历史任务缓存: {sub.name}")
                        cleaned_count += 1
                    except Exception as e:
                        logger.error(f"[StorageGC] 清理目录失败 {sub}: {e}")

        return cleaned_count
