import os, re, hashlib
from pathlib import Path

DEST = Path("D:/motion/.workbuddy/skills")
USER = Path(os.path.expanduser("~")) / ".workbuddy" / "skills"

RE_FM = re.compile(r"\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\Z)", re.S)
RE_NAME = re.compile(r"^[ \t]*name[ \t]*:[ \t]*(.+?)[ \t]*\r?$", re.M)
RE_DESC = re.compile(r"^[ \t]*description[ \t]*:[ \t]*(.+?)[ \t]*\r?$", re.M)

print("%-24s %-10s %-8s %-10s %s" % ("skill", "name 一致", "desc", "与用户级", "备注"))
print("-" * 78)
allok = True
for d in sorted(p for p in DEST.iterdir() if p.is_dir()):
    f = d / "SKILL.md"
    raw = f.read_bytes()
    if raw[:3] == b"\xef\xbb\xbf":
        raw = raw[3:]
    t = raw.decode("utf-8", errors="ignore")
    m = RE_FM.match(t)
    nm = RE_NAME.search(m.group(1)) if m else None
    ds = RE_DESC.search(m.group(1)) if m else None
    name = nm.group(1).strip().strip("\"'") if nm else None

    uf = USER / d.name / "SKILL.md"
    same = "相同"
    if uf.exists():
        same = "相同" if uf.read_bytes() == f.read_bytes() else "差异"
    else:
        same = "用户级缺失"

    nameok = (name == d.name)
    if not nameok or not ds or same != "相同":
        allok = False
    print("%-24s %-10s %-8s %-10s %s" % (
        d.name, "OK" if nameok else "DIFF(%s)" % name,
        "yes" if ds else "NO", same,
        "" if (nameok and ds and same == "相同") else "需检查"))

print("\n结论:", "项目级 3 个 skill 全部合规且与用户级一致" if allok else "存在问题，见上表")
