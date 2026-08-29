"""纯 Python Ed25519 验签（RFC 8032）— 零外部依赖，用于 Mac Publisher 验包。

只实现 verify；私钥签名始终在 Windows producer（Secret Store）。
已验证：RFC 8032 Test 1 + contracts/vectors 三端互验。
"""
import hashlib

P = 2**255 - 19
D = (-121665 * pow(121666, P - 2, P)) % P
L = 2**252 + 27742317777372353535851937790883648493


class Point:
    __slots__ = ("x", "y")

    def __init__(self, x: int, y: int):
        self.x = x % P
        self.y = y % P

    def __eq__(self, other: "Point") -> bool:  # type: ignore[override]
        return self.x == other.x and self.y == other.y


def _inv(a: int) -> int:
    return pow(a % P, P - 2, P)


def _add(p: Point, q: Point) -> Point:
    x1, y1 = p.x, p.y
    x2, y2 = q.x, q.y
    x3 = (x1 * y2 + x2 * y1) * _inv(1 + D * x1 * x2 * y1 * y2) % P
    y3 = (y1 * y2 + x1 * x2) * _inv(1 - D * x1 * x2 * y1 * y2) % P
    return Point(x3, y3)


def _scalar_mult(n: int, p: Point) -> Point:
    result = Point(0, 1)
    addend = p
    while n > 0:
        if n & 1:
            result = _add(result, addend)
        addend = _add(addend, addend)
        n >>= 1
    return result


def _recover_x(y: int, sign: int) -> int:
    x2 = (y * y - 1) * _inv(D * y * y + 1) % P
    if x2 == 0:
        return 0
    x = pow(x2, (P + 3) // 8, P)
    if (x * x - x2) % P != 0:
        x = x * pow(2, (P - 1) // 4, P) % P
    if (x * x - x2) % P != 0:
        raise ValueError("invalid x recovery")
    if (x & 1) != sign:
        x = P - x
    return x


_BY = 4 * pow(5, P - 2, P) % P
B = Point(_recover_x(_BY, 0), _BY)
IDENTITY = Point(0, 1)


def _point_from_bytes(b: bytes) -> Point:
    if len(b) != 32:
        raise ValueError("point must be 32 bytes")
    y = int.from_bytes(b, "little") & ((1 << 255) - 1)
    sign = (b[31] >> 7) & 1
    if y >= P:
        raise ValueError("y out of range")
    return Point(_recover_x(y, sign), y)


def _point_to_bytes(p: Point) -> bytes:
    y = p.y % P
    x = p.x % P
    return (y | ((x & 1) << 255)).to_bytes(32, "little")


def verify(public_key: bytes, signature: bytes, message: bytes) -> bool:
    """Ed25519 验签。public_key/signature 均为 32/64 字节原始字节。"""
    if len(public_key) != 32 or len(signature) != 64:
        return False
    try:
        a = _point_from_bytes(public_key)
    except ValueError:
        return False
    if _scalar_mult(8, a) == IDENTITY:
        return False
    r_enc = signature[:32]
    s = int.from_bytes(signature[32:], "little")
    if s >= L:
        return False
    try:
        r = _point_from_bytes(r_enc)
    except ValueError:
        return False
    if _scalar_mult(8, r) == IDENTITY:
        return False
    k = int.from_bytes(hashlib.sha512(r_enc + public_key + message).digest(), "little") % L
    sb = _scalar_mult(s, B)
    ka = _scalar_mult(k, a)
    # Edwards 取反：-(x, y) = (-x, y)
    r_prime = _add(sb, Point((-ka.x) % P, ka.y))
    return _point_to_bytes(r_prime) == r_enc


def verify_pem(public_key_pem: str, signature_b64url: str, message: bytes) -> bool:
    """从 SPKI PEM 提取原始公钥字节后验签（签名 base64url 无填充）。"""
    import base64

    pem_body = "".join(
        ln for ln in public_key_pem.splitlines() if not ln.startswith("-----")
    )
    der = base64.b64decode(pem_body)
    raw = der[-32:]
    sig = base64.urlsafe_b64decode(signature_b64url + "=" * (-len(signature_b64url) % 4))
    return verify(raw, sig, message)


# ── 签名（仅测试/工具用；生产私钥始终在 Windows Secret Store） ──

def public_key_from_secret(secret: bytes) -> bytes:
    h = hashlib.sha512(secret).digest()
    hb = bytearray(h[:32])
    hb[0] &= 248
    hb[31] &= 63
    hb[31] |= 64
    scalar = int.from_bytes(bytes(hb), "little")
    return _point_to_bytes(_scalar_mult(scalar, B))


def sign(secret: bytes, message: bytes) -> bytes:
    h = hashlib.sha512(secret).digest()
    hb = bytearray(h[:32])
    hb[0] &= 248
    hb[31] &= 63
    hb[31] |= 64
    scalar = int.from_bytes(bytes(hb), "little")
    prefix = h[32:]
    a_point = _scalar_mult(scalar, B)
    a_enc = _point_to_bytes(a_point)
    r = int.from_bytes(hashlib.sha512(prefix + message).digest(), "little") % L
    r_point = _scalar_mult(r, B)
    r_enc = _point_to_bytes(r_point)
    k = int.from_bytes(hashlib.sha512(r_enc + a_enc + message).digest(), "little") % L
    s_val = (r + k * scalar) % L
    return r_enc + s_val.to_bytes(32, "little")


def sign_pem(private_key_pem: str, message: bytes) -> str:
    """PKCS8 PEM → base64url 签名（无填充）。"""
    import base64

    pem_body = "".join(ln for ln in private_key_pem.splitlines() if not ln.startswith("-----"))
    der = base64.b64decode(pem_body)
    return base64.urlsafe_b64encode(sign(der[-32:], message)).rstrip(b"=").decode("ascii")
