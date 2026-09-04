import re, os, json
from pathlib import Path
DEST = Path(os.path.expanduser("~"))/".workbuddy"/"skills"

print(f"{'目录名':30} {'frontmatter.name':30} {'一致':6} {'desc':5} 备注")
print("-"*100)
issues = []
for d in sorted(p for p in DEST.iterdir() if p.is_dir()):
    f = d/"SKILL.md"
    if not f.exists():
        issues.append((d.name,"无 SKILL.md")); print(f"{d.name:30} {'--':30} {'NO':6}"); continue
    t = f.read_text(encoding="utf-8", errors="ignore")
    m = re.match(r"^---\r?\n(.*?)\r?\n---", t, re.S)
    if not m:
        issues.append((d.name,"无 frontmatter")); print(f"{d.name:30} {'--':30} {'NO':6} 缺失 frontmatter"); continue
    fm = m.group(1)
    nm = re.search(r"^name:/s*(.+)$", fm, re.M)
    ds = re.search(r"^description:/s*(.+)$", fm, re.M)
    name = nm.group(1).strip().strip('"\'') if nm else None
    has_desc = bool(ds)
    same = "OK" if name == d.name else "DIFF"
    note = ""
    if name != d.name:
        issues.append((d.name, f"name={name}")); note = f"frontmatter name 为 '{name}'"
    print(f"{d.name:30} {str(name)[:29]:30} {same:6} {'yes' if has_desc else 'NO':5} {note}")

print(f"\n问题项 {len(issues)}: {issues if issues else '无'}")
