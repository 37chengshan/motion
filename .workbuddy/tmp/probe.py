import json, hashlib
from pathlib import Path
lock = json.loads(Path("D:/motion/skills.lock.json").read_text(encoding="utf-8"))
skills = {s["skill"]: s for s in lock["skills"]}

# 取 1 个 MATCH 样本 + 1 个 MISMATCH 样本对比特征
for name in ["hyperframes-keyframes", "hyperframes-core", "watch"]:
    p = Path(f"D:/motion/.agents/skills/{name}/SKILL.md")
    if not p.exists():
        p = Path.home()/".claude"/"skills"/name/"SKILL.md"
    b = p.read_bytes()
    print(f"--- {name}  size={len(b)}  CRLF={b.count(b'\r\n')}  LF={b.count(b'\n')}  BOM={b[:3]==b'\xef\xbb\xbf'}")
    print(f"    lock sk_md = {skills[name]['sk_md_digest'][:20]}")
    variants = {
        "raw":       b,
        "crlf->lf":  b.replace(b"\r\n", b"\n"),
        "lf->crlf":  b.replace(b"\n", b"\r\n").replace(b"\r\r\n", b"\r\n"),
        "no_bom":    b[3:] if b[:3]==b'\xef\xbb\xbf' else b,
        "norm+strip":b.replace(b"\r\n", b"\n").strip(),
    }
    for k,v in variants.items():
        d = hashlib.sha256(v).hexdigest()
        mark = "  <== MATCH" if d == skills[name]["sk_md_digest"] else ""
        print(f"    {k:12} {d[:20]}{mark}")
