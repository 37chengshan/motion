# -*- coding: utf-8 -*-
"""读取 Chrome Cookies（绕过独占锁）并导出 X 域 cookie 的加密值
输出: JSON [{host,name,enc_b64,path}] 到 stdout —— 供 Node 侧 AES-GCM 解密
安全: 只输出加密态值；解密在内存进行，不写盘
"""
import base64
import ctypes
import json
import sqlite3
import sys
import tempfile
from ctypes import wintypes

GENERIC_READ = 0x80000000
FILE_SHARE_READ = 0x1
FILE_SHARE_WRITE = 0x2
FILE_SHARE_DELETE = 0x4
OPEN_EXISTING = 3
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value

k32 = ctypes.windll.kernel32
k32.CreateFileW.restype = ctypes.c_void_p
k32.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                            wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]


def read_file_shared(path: str) -> bytes:
    h = k32.CreateFileW(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                        None, OPEN_EXISTING, 0x80, None)
    if h == INVALID_HANDLE_VALUE:
        raise OSError("cannot open (locked?): " + path)
    try:
        chunks = []
        buf = ctypes.create_string_buffer(1 << 20)
        n = wintypes.DWORD(0)
        while True:
            ok = k32.ReadFile(ctypes.c_void_p(h), buf, 1 << 20, ctypes.byref(n), None)
            if not ok or n.value == 0:
                break
            chunks.append(buf.raw[: n.value])
        return b"".join(chunks)
    finally:
        k32.CloseHandle(ctypes.c_void_p(h))


def main() -> None:
    cookie_path = sys.argv[1] if len(sys.argv) > 1 else (
        r"C:\Users\10777\AppData\Local\Google\Chrome\User Data\Default\Network\Cookies")
    data = read_file_shared(cookie_path)
    # 写临时副本供 sqlite3 打开（内存不行，sqlite 需要文件或 blob）
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        f.write(data)
        tmp = f.name
    try:
        con = sqlite3.connect(tmp)
        rows = con.execute(
            "SELECT host_key, name, path, encrypted_value FROM cookies "
            "WHERE (host_key LIKE '%x.com' OR host_key LIKE '%twitter.com' OR host_key LIKE '%.x.ai') "
            "ORDER BY host_key, name"
        ).fetchall()
        out = [{"host": r[0], "name": r[1], "path": r[2], "enc": base64.b64encode(r[3]).decode()}
               for r in rows if r[3]]
        print(json.dumps(out, ensure_ascii=False))
        con.close()
    finally:
        import os
        os.unlink(tmp)


if __name__ == "__main__":
    main()
