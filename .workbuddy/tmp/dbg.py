import os, re
from pathlib import Path
f = Path(os.path.expanduser("~"))/".workbuddy"/"skills"/"hyperframes"/"SKILL.md"
b = f.read_bytes()
print("前 160 字节 repr:", repr(b[:160]))
print("文件长度:", len(b))
t = f.read_text(encoding="utf-8", errors="ignore")
print("text 前 160 repr:", repr(t[:160]))
m = re.match(r"^---\r?\n(.*?)\r?\n---", t, re.S)
print("\nfrontmatter 匹配:", bool(m))
if m:
    fm = m.group(1)
    print("fm repr (前400):", repr(fm[:400]))
    print("name 搜索结果:", re.search(r"^name:/s*(.+)$", fm, re.M))
