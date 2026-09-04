import os, hashlib, json
from pathlib import Path

LOCK = Path("D:/motion/skills.lock.json")
WB = Path(os.path.expanduser("~")) / ".workbuddy" / "skills"
PROJ = Path("D:/motion/.agents/skills")
LOCAL = Path(os.path.expanduser("~")) / ".claude" / "skills"

lock = json.loads(LOCK.read_text(encoding="utf-8"))
by_name = {s["skill"]: s for s in lock["skills"]}


def sk_md(p: Path) -> str:
    b = p.read_bytes()
    if b[:3] == b"\xef\xbb\xbf":
        b = b[3:]
    return hashlib.sha256(b.replace(b"\r\n", b"\n")).hexdigest()


# ---- 修正：motion-media-handoff 安装时改过 frontmatter name，锁须记录安装产物 ----
e = by_name["motion-media-handoff"]
installed = WB / "motion-media-handoff" / "SKILL.md"
src = PROJ / "hyperframes-media" / "SKILL.md"
if sk_md(installed) != e["sk_md_digest"]:
    e["source_sk_md_digest"] = sk_md(src)          # 源
    e["sk_md_digest"] = sk_md(installed)           # 安装产物（权威）
    e["install_transform"] = "frontmatter name 由 hyperframes-media 改为 motion-media-handoff（避免与官方原子技能重名）"
    print("已修正 motion-media-handoff 的 digest 为安装产物值")

LOCK.write_text(json.dumps(lock, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

# ---- 端到端校验：WorkBuddy 安装目录 vs 锁文件 ----
print("\n%s" % ("=" * 92))
print("%-30s %-10s %-10s %s" % ("WORKUDDY 安装名", "锁文件", "SKILL.md", "校验"))
print("=" * 92)
ok = mismatch = nolock = 0
for d in sorted(p for p in WB.iterdir() if p.is_dir()):
    f = d / "SKILL.md"
    has = f.exists()
    e = by_name.get(d.name)
    if not e:
        print("%-30s %-10s %-10s %s" % (d.name, "缺失", "yes" if has else "NO", "未在锁文件中"))
        nolock += 1
        continue
    if not has:
        print("%-30s %-10s %-10s %s" % (d.name, "有", "NO", "SKILL.md 缺失"))
        mismatch += 1
        continue
    got, want = sk_md(f), e["sk_md_digest"]
    flag = "PASS" if got == want else "DIFF"
    if flag == "PASS":
        ok += 1
    else:
        mismatch += 1
    note = "" if flag == "PASS" else "  锁=%s 实际=%s" % (want[:12], got[:12])
    print("%-30s %-10s %-10s %s%s" % (d.name, "有", "yes", flag, note))

total = sum(1 for p in WB.iterdir() if p.is_dir())
print("=" * 92)
print("WorkBuddy 目录数 %d | 锁条目 %d | PASS %d | DIFF %d | 未入锁 %d"
      % (total, len(lock["skills"]), ok, mismatch, nolock))
