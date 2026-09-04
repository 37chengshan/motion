import os, hashlib, json
from pathlib import Path

lock = json.loads(Path("D:/motion/skills.lock.json").read_text(encoding="utf-8"))
skills = {s["skill"]: s for s in lock["skills"]}

# 用结构简单、文件少的未漂移项做算法反推
CANDIDATES = ["lottie-animation", "60fps-animation", "shot-composition", "beat-sync-editing"]
ROOT = Path("D:/motion/.agents/skills")


def norm(b: bytes) -> bytes:
    if b[:3] == b"\xef\xbb\xbf":
        b = b[3:]
    return b.replace(b"\r\n", b"\n")


def files_of(d: Path):
    return sorted([f for f in d.rglob("*") if f.is_file()], key=lambda p: str(p.relative_to(d)).replace("\\", "/"))


def alg_a(d):  # 路径+内容 拼接
    h = hashlib.sha256()
    for f in files_of(d):
        rel = str(f.relative_to(d)).replace("\\", "/")
        h.update(rel.encode())
        h.update(norm(f.read_bytes()))
    return h.hexdigest()


def alg_b(d):  # 仅内容拼接（按路径排序）
    h = hashlib.sha256()
    for f in files_of(d):
        h.update(norm(f.read_bytes()))
    return h.hexdigest()


def alg_c(d):  # 路径:sha256 清单
    h = hashlib.sha256()
    for f in files_of(d):
        rel = str(f.relative_to(d)).replace("\\", "/")
        h.update(("%s:%s\n" % (rel, hashlib.sha256(norm(f.read_bytes())).hexdigest())).encode())
    return h.hexdigest()


def alg_d(d):  # 相对路径逐行 + 内容
    h = hashlib.sha256()
    for f in files_of(d):
        rel = str(f.relative_to(d)).replace("\\", "/")
        h.update((rel + "\n").encode())
        h.update(norm(f.read_bytes()))
        h.update(b"\n")
    return h.hexdigest()


for name in CANDIDATES:
    d = ROOT / name
    if not d.exists():
        continue
    want = skills[name]["source_tree_digest"]
    fl = [str(f.relative_to(d)).replace("\\", "/") for f in files_of(d)]
    print("=== %s  文件: %s" % (name, fl))
    print("    expect: %s" % want)
    for fn in (alg_a, alg_b, alg_c, alg_d):
        got = fn(d)
        print("    %s: %s %s" % (fn.__name__, got[:24], "  <== MATCH" if got == want else ""))
