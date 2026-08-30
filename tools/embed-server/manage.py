# -*- coding: utf-8 -*-
"""embed-server 服务管理脚本（Windows）

用法：
  python manage.py start   启动 embed-server（后台，日志 tools/embed-server/server.log）
  python manage.py stop    停止 embed-server
  python manage.py status  查看运行状态（/health 探活 + 显存占用）

要点：
- 模型常驻 GPU（RTX 5060 / 8GB，Qwen3-VL-Embedding-2B bf16 约 4GB）
- 冷启动 20-60s（GPU 首次加载），之后毫秒级响应
- 环境变量 EMBED_MODEL_DIR / EMBED_DIM 可覆盖默认值
"""
from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PY = ROOT / ".venv3" / "Scripts" / "python.exe"
PORT = int(os.environ.get("EMBED_PORT", "8765"))
LOG = ROOT / "server.log"
PID_FILE = ROOT / "server.pid"


def _read_pid() -> int | None:
    try:
        return int(PID_FILE.read_text().strip())
    except (FileNotFoundError, ValueError):
        return None


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _health() -> dict | None:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=3) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None


def _port_pids() -> list[int]:
    """netstat 找出监听 PORT 的进程 PID（处理 pid 文件过期/双实例场景）
    注意：中文 Windows 的 netstat 输出 GBK（如"活动连接"），需显式编码容错，
    text=True 默认 utf-8 会 UnicodeDecodeError 导致 stdout 为 None。
    """
    out = subprocess.run(
        ["netstat", "-ano"], capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=10,
    ).stdout or ""
    pids = set()
    for line in out.splitlines():
        if f":{PORT}" in line and "LISTENING" in line:
            parts = line.split()
            if parts and parts[-1].isdigit():
                pids.add(int(parts[-1]))
    return sorted(pids)


def start() -> int:
    if _read_pid() and _alive(_read_pid()):
        print(f"[embed] already running (pid {_read_pid()})")
        return 0
    # 端口被占但 pid 文件对不上（旧实例残留）→ 先按端口清理
    for pid in _port_pids():
        print(f"[embed] port {PORT} occupied by stale pid {pid}, killing it")
        subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True)
    cmd = [str(PY), "-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", str(PORT)]
    log = open(LOG, "a", encoding="utf-8")
    proc = subprocess.Popen(cmd, cwd=ROOT, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
    PID_FILE.write_text(str(proc.pid))
    print(f"[embed] starting pid {proc.pid}, waiting for /health ...")
    for _ in range(90):
        time.sleep(1)
        h = _health()
        if h:
            # Windows venv python.exe 是 launcher：Popen 拿到的 pid 可能不是
            # 真正监听端口的进程，用端口校准 pid 文件
            real = _port_pids()
            if real:
                PID_FILE.write_text(str(real[0]))
                print(f"[embed] up: {json.dumps(h, ensure_ascii=False)} (pid {real[0]})")
            else:
                print(f"[embed] up: {json.dumps(h, ensure_ascii=False)}")
            return 0
    print("[embed] start timeout (90s), see server.log")
    return 1


def stop() -> int:
    pids = []
    pid = _read_pid()
    if pid and _alive(pid):
        pids.append(pid)
    for p in _port_pids():
        if p not in pids:
            pids.append(p)
    if not pids:
        print("[embed] not running")
        PID_FILE.unlink(missing_ok=True)
        return 0
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
    time.sleep(1)
    for pid in pids:
        try:
            subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True, timeout=10)
        except Exception:
            pass
    PID_FILE.unlink(missing_ok=True)
    print(f"[embed] stopped (pids {pids})")
    return 0


def status() -> int:
    h = _health()
    port_pids = _port_pids()
    pid = _read_pid()
    live = pid if pid and _alive(pid) else None
    if not live and port_pids:
        live = port_pids[0]  # pid 文件过期时按端口修正
    if h:
        print(f"[embed] RUNNING pid={live} model={h.get('model')} loaded={h.get('loaded')} dim={h.get('dim')}")
        try:
            out = subprocess.run(
                ["nvidia-smi", "--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5,
            ).stdout.strip()
            print(f"[embed] GPU: {out}")
        except Exception:
            pass
        return 0
    print(f"[embed] STOPPED (pid={pid})")
    return 1


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "start":
        sys.exit(start())
    elif cmd == "stop":
        sys.exit(stop())
    elif cmd == "status":
        sys.exit(status())
    else:
        print(__doc__)
        sys.exit(2)


if __name__ == "__main__":
    main()
