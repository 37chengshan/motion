import os, shutil, json
from pathlib import Path

HOME = Path(os.path.expanduser("~"))
DEST = HOME/".workbuddy"/"skills"
DEST.mkdir(parents=True, exist_ok=True)

PROJ = Path("D:/motion/.agents/skills")
LOCAL = HOME/".claude"/"skills"

# (源根, 源目录名, 安装名, 类别)
PLAN = []
for n in sorted(p.name for p in PROJ.iterdir() if (p/"SKILL.md").exists()):
    target = "motion-media-handoff" if n == "hyperframes-media" else n
    PLAN.append((PROJ, n, target, "project"))
for n in ["hyperframes","hyperframes-core","hyperframes-animation","hyperframes-keyframes",
          "hyperframes-creative","hyperframes-cli","media-use","hyperframes-audio",
          "hyperframes-registry","hyperframes-media"]:
    PLAN.append((LOCAL, n, n, "upstream"))

EXCLUDE_DIRS = {"node_modules",".git","__pycache__",".venv","venv",".idea",".vscode","dist","build"}
EXCLUDE_SFX  = {".pyc",".pyo",".DS_Store",".map"}

def copy_dir(src: Path, dst: Path):
    n = 0
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        r = Path(root)
        for f in files:
            if Path(f).suffix in EXCLUDE_SFX: continue
            s = r/f
            rel = s.relative_to(src)
            d = dst/rel
            d.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(s, d)
            n += 1
    return n

print(f"{'安装名':30} {'类别':9} {'文件':>5} {'体积':>9}  源")
print("-"*95)
installed, failed = [], []
for root, src_name, target, kind in PLAN:
    src = root/src_name
    dst = DEST/target
    if not (src/"SKILL.md").exists():
        failed.append((target, "缺 SKILL.md")); print(f"{target:30} {kind:9} {'SKIP':>5}  缺 SKILL.md"); continue
    if dst.exists():
        shutil.rmtree(dst)
    n = copy_dir(src, dst)
    size = sum(f.stat().st_size for f in dst.rglob("*") if f.is_file())
    mb = f"{size/1024/1024:.1f}MB" if size > 1024*1024 else f"{size/1024:.0f}KB"
    print(f"{target:30} {kind:9} {n:>5} {mb:>9}  {src}")
    installed.append({"name":target, "src_name":src_name, "kind":kind, "files":n, "bytes":size,
                      "origin":str(src).replace("\\","/")})

print(f"\n安装完成: {len(installed)}/{len(PLAN)}" + (f"  失败: {failed}" if failed else ""))
json.dump(installed, open("D:/motion/.workbuddy/tmp/installed.json","w"), indent=1, ensure_ascii=False)
