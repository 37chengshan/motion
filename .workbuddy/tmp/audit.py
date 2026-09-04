import os, re, json
from pathlib import Path
HOME = Path(os.path.expanduser("~"))
roots = [Path("D:/motion/.agents/skills"), HOME/".claude"/"skills"]
names = ["video-spec-builder","watch","srt-vox-director","srt-whiteboard-animation","whiteboard-stream-animation","ai-motion-director","reference-video-replica-qc","animation-principles","shot-composition","motion-art-direction","beat-sync-editing","remotion-video","gsap-web","60fps-animation","svg-animation","lottie-animation","hyperframes","hyperframes-core","hyperframes-animation","hyperframes-keyframes","hyperframes-creative","hyperframes-cli","media-use","hyperframes-audio","hyperframes-registry","hyperframes-media","motion-design","video-agency-roles"]

# 高危模式
P0 = [r"curl\s+[^|]*\|\s*(ba)?sh", r"wget\s+[^|]*\|\s*(ba)?sh", r"rm\s+-rf\s+[/~$]",
      r"eval\s*\(", r"base64\s+-d\s*\|", r"Invoke-Expression", r"iex\s*\("]
P1 = [r"https?://(?!github\.com|raw\.githubusercontent|www\.npmjs\.com|registry\.npmjs\.org)[a-z0-9.-]+\.(xyz|top|tk|ml|ga|cf|gq|ru|cn)",
      r"(api[_-]?key|secret|token|password)\s*[:=]\s*['\"][A-Za-z0-9_\-]{16,}",
      r"~/.ssh", r"id_rsa", r"\.aws/credentials", r"process\.env\.HOME"]
P2 = [r"sudo\s+", r"chmod\s+777", r"git\s+push\s+.*--force", r"--no-verify", r"Set-ExecutionPolicy"]

def scan_file(f: Path):
    try: t = f.read_text(encoding="utf-8", errors="ignore")
    except: return []
    hits=[]
    for lvl, pats in (("P0",P0),("P1",P1),("P2",P2)):
        for p in pats:
            for m in re.finditer(p, t, re.I):
                line = t[:m.start()].count("\n")+1
                hits.append((lvl, p[:34], line))
    return hits

print(f"{'skill':30} {'files':>6} {'scripts':>8}  findings")
print("-"*80)
total = {"P0":0,"P1":0,"P2":0}
for n in names:
    d = None
    for r in roots:
        c = r/n
        if (c/"SKILL.md").exists(): d = c; break
    if not d: print(f"{n:30} {'MISSING':>6}"); continue
    files = [f for f in d.rglob("*") if f.is_file()]
    scripts = [f for f in files if f.suffix in {".sh",".ps1",".bat",".py",".js",".mjs",".exe",".cmd"}]
    hits=[]
    for f in files:
        if f.suffix in {".md",".sh",".ps1",".bat",".py",".js",".mjs",".json",".yaml",".yml",".txt"} or f.name=="SKILL.md":
            for lvl,pat,line in scan_file(f):
                hits.append(f"{lvl}:{f.relative_to(d)}:{line}")
    c = sum(1 for h in hits if h.startswith("P0")), sum(1 for h in hits if h.startswith("P1")), sum(1 for h in hits if h.startswith("P2"))
    total["P0"]+=c[0]; total["P1"]+=c[1]; total["P2"]+=c[2]
    flag = "clean" if not hits else f"P0={c[0]} P1={c[1]} P2={c[2]}"
    print(f"{n:30} {len(files):>6} {len(scripts):>8}  {flag}")
    for h in hits[:6]: print(f"    {h}")
print("\nTOTAL:", total)
