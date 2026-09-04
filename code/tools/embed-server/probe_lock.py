# -*- coding: utf-8 -*-
"""用 CreateFileW(FILE_SHARE_READ|WRITE|DELETE) 探测 Chrome Cookies 锁是否允许共享读"""
import ctypes
from ctypes import wintypes

GENERIC_READ = 0x80000000
FILE_SHARE_READ = 0x1
FILE_SHARE_WRITE = 0x2
FILE_SHARE_DELETE = 0x4
OPEN_EXISTING = 3
FILE_ATTRIBUTE_NORMAL = 0x80
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value

k32 = ctypes.windll.kernel32
k32.CreateFileW.restype = ctypes.c_void_p
k32.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                            wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]

paths = [
    r"C:\Users\10777\AppData\Local\Google\Chrome\User Data\Default\Network\Cookies",
    r"C:\Users\10777\AppData\Local\Microsoft\Edge\User Data\Default\Network\Cookies",
]
for p in paths:
    h = k32.CreateFileW(p, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                        None, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, None)
    if h == INVALID_HANDLE_VALUE:
        print("LOCKED:", p)
    else:
        buf = ctypes.create_string_buffer(16)
        n = wintypes.DWORD(0)
        ok = k32.ReadFile(ctypes.c_void_p(h), buf, 16, ctypes.byref(n), None)
        k32.CloseHandle(ctypes.c_void_p(h))
        print("READ OK:", p, "->", buf.raw[:16] if ok else "read-fail", "bytes:", n.value)
