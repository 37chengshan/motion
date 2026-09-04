import json, hashlib, os, sys
from pathlib import Path

HOME = Path(os.path.expanduser("~"))
lock = json.loads(Path("D:/motion/skills.lock.json").read_text(encoding="utf-8"))
skills = {s["skill"]: s for s in lock["skills"]}

def sha(p):
    if not p.exists(): return None
    return hashlib.sha256(p.read_bytes()).hexdigest()

print(f"{'skill':32} {'lock-digest-match':18} source")
print("-"*90)
results = {}
for name, meta in skills.items():
    dig = meta.get("sk_md_digest")
    # 候选来源：项目内 .agents/skills 优先，其次本地 ~/.claude/skills
    cands = [Path(f"D:/motion/.agents/skills/{name}/SKILL.md"),
             HOME/".claude"/"skills"/name/"SKILL.md"]
    hit = None
    for c in cands:
        if c.exists() and sha(c) == dig:
            hit = c; break
    if hit:
        print(f"{name:32} {'MATCH':18} {str(hit)}")
        results[name] = ("match", str(hit))
    else:
        # 找最接近的
        found = [str(c) for c in cands if c.exists()]
        d = sha(cands[0]) if cands[0].exists() else (sha(cands[1]) if cands[1].exists() else "absent")
        print(f"{name:32} {'MISMATCH':18} candidates={found} got={d[:16]}")
        results[name] = ("mismatch", found)

# 额外：项目内但不在 lock 里的目录
proj = {p.name for p in Path("D:/motion/.agents/skills").iterdir() if p.is_dir() and (p/"SKILL.md").exists()}
extra = proj - set(skills)
print("\n项目内存在但 lock 未记录:", sorted(extra) if extra else "无")
json.dump(results, open("D:/motion/.workbuddy/tmp/verify.json","w"), indent=1)
