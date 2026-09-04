# -*- coding: utf-8 -*-
"""解 Chrome DPAPI 加密的 AES key（仅本机当前用户可解；输出 base64 密钥供解密 cookie）
用法: python chrome_key.py -> 打印 32 字节 AES key 的 base64
安全: 密钥只在内存/管道传递，不落盘
"""
import base64
import ctypes
import ctypes.wintypes
import json
import sys

class DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", ctypes.wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

def unprotect(blob_in: bytes) -> bytes:
    inblob = DATA_BLOB(len(blob_in), ctypes.cast(ctypes.c_char_p(blob_in), ctypes.POINTER(ctypes.c_char)))
    outblob = DATA_BLOB()
    if not ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(inblob), None, None, None, None, 0, ctypes.byref(outblob)
    ):
        raise OSError("CryptUnprotectData failed")
    try:
        return ctypes.string_at(outblob.pbData, outblob.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(outblob.pbData)

def main() -> None:
    ls_path = sys.argv[1] if len(sys.argv) > 1 else (
        r"C:\Users\10777\AppData\Local\Google\Chrome\User Data\Local State")
    with open(ls_path, "r", encoding="utf-8") as f:
        ls = json.load(f)
    ek = base64.b64decode(ls["os_crypt"]["encrypted_key"])
    assert ek[:5] == b"DPAPI", "unexpected prefix: " + str(ek[:5])
    key = unprotect(ek[5:])
    assert len(key) == 32, "key len %d" % len(key)
    sys.stdout.write(base64.b64encode(key).decode() + "\n")

if __name__ == "__main__":
    main()
