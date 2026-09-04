import os, re, json
from pathlib import Path

DEST = Path(os.path.expanduser("~")) / ".workbuddy" / "skills"

# 用字符类代替 \s，避免任何转义歧义
RE_FM = re.compile(r"\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\Z)", re.S)
RE_NAME = re.compile(r"^[ \t]*name[ \t]*:[ \t]*(.+?)[ \t]*\r?$", re.M)
RE_DESC = re.compile(r"^[ \t]*description[ \t]*:[ \t]*(.+?)[ \t]*\r?$", re.M)

print("%-30s %-30s %-6s %-6s %s" % ("目录名", "frontmatter.name", "一致", "desc", "备注"))
print("-" * 104)
issues = []
rows = []
for d in sorted(p for p in DEST.iterdir() if p.is_dir()):
    f = d / "SKILL.md"
    if not f.exists():
        issues.append((d.name, "无 SKILL.md"))
        print("%-30s %-30s %-6s %-6s" % (d.name, "--", "NO", "-"))
        continue
    raw = f.read_bytes()
    if raw[:3] == b"\xef\xbb\xbf":
        raw = raw[3:]
    t = raw.decode("utf-8", errors="ignore")
    m = RE_FM.match(t)
    if not m:
        issues.append((d.name, "无 frontmatter"))
        print("%-30s %-30s %-6s %-6s %s" % (d.name, "--", "NO", "-", "frontmatter 缺失"))
        continue
    fm = m.group(1)
    nm = RE_NAME.search(fm)
    ds = RE_DESC.search(fm)
    name = nm.group(1).strip().strip("\"'") if nm else None
    has_desc = bool(ds)
    same = "OK" if name == d.name else "DIFF"
    note = ""
    if name != d.name:
        issues.append((d.name, "name=%s" % name))
        note = "frontmatter name = %r" % name
    if not has_desc:
        issues.append((d.name, "缺 description"))
        note = (note + "; 缺 description").strip("; ")
    print("%-30s %-30s %-6s %-6s %s" % (d.name, str(name)[:29], same, "yes" if has_desc else "NO", note))
    rows.append({"dir": d.name, "name": name, "desc": has_desc, "match": name == d.name})

print("\n目录总数: %d" % len(rows))
print("问题项 %d: %s" % (len(issues), issues if issues else "无"))
json.dump({"rows": rows, "issues": [list(i) for i in issues]},
          open("D:/motion/.workbuddy/tmp/check2.json", "w"), indent=1, ensure_ascii=False)
