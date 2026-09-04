"""RFC 8785 (JCS) 最小实现 — 与 contracts/vectors / producer / cloud 三方严格一致。

规则：对象键字典序、无空白、安全整数（禁浮点）；字符串 UTF-8 原样（不转义非 ASCII）。
"""
import json
from typing import Any


def _canonical(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        if not (-(2**63) <= value < 2**63):
            raise ValueError(f"non-safe-int in JCS: {value}")
        return str(value)
    if isinstance(value, float):
        raise ValueError("JCS 禁止浮点（跨 Node/Python canonicalization 歧义）")
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_canonical(v) for v in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(
            json.dumps(k, ensure_ascii=False) + ":" + _canonical(value[k])
            for k in sorted(value.keys())
        ) + "}"
    raise ValueError(f"unsupported JCS type: {type(value)}")


def jcs_serialize(value: Any) -> str:
    return _canonical(value)


def canonical_for_signing(manifest: dict, key_id: str) -> bytes:
    """签名输入 = 移除 signature.value 后的完整 manifest 的 JCS（保留 algorithm/key_id/canonicalization）"""
    without_value = {
        **manifest,
        "signature": {"algorithm": "Ed25519", "key_id": key_id, "canonicalization": "JCS"},
    }
    return jcs_serialize(without_value).encode("utf-8")
