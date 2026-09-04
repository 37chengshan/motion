import json, hashlib, os
from pathlib import Path
HOME = Path(os.path.expanduser("~"))
lock = json.loads(Path("D:/motion/skills.lock.json").read_text(encoding="utf-8"))
skills = {s["skill"]: s for s in lock["skills"]}

def dig(p):
    b = p.read_bytes()
    if b[:3] == b'\xef\xbb\xbf': b = b[3:]
    return hashlib.sha256(b.replace(b"\r\n", b"\n")).hexdigest()

print(f"{'skill':30} {'status':12} source")
print("-"*88)
ok, bad = [], []
for name, meta in skills.items():
    cands = [Path(f"D:/motion/.agents/skills/{name}/SKILL.md"),
             HOME/".claude"/"skills"/name/"SKILL.md"]
    hit = None
    for c in cands:
        if c.exists() and dig(c) == meta["sk_md_digest"]:
            hit = c; break
    if hit:
        ok.append(name); print(f"{name:30} {'VERIFIED':12} {hit}")
    else:
        ex = [str(c) for c in cands if c.exists()]
        bad.append(name); print(f"{name:30} {'DRIFTED':12} exists={ex}")

proj = {p.name for p in Path("D:/motion/.agents/skills").iterdir()
        if p.is_dir() and (p/"SKILL.md").exists()}
print("\n项目内未被 lock 覆盖:", sorted(proj - set(skills)))
print(f"\n校验通过 {len(ok)}/{len(skills)}；漂移 {len(bad)}: {bad if bad else '无'}")
json.dump({"ok":ok,"drifted":bad}, open("D:/motion/.workbuddy/tmp/verify2.json","w"), indent=1)
