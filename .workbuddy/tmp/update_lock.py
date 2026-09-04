import os, shutil, hashlib, json, datetime
from pathlib import Path

LOCK = Path("D:/motion/skills.lock.json")
BAK = Path("D:/motion/.workbuddy/tmp/skills.lock.json.bak")
PROJ = Path("D:/motion/.agents/skills")
LOCAL = Path(os.path.expanduser("~")) / ".claude" / "skills"
CLI_VERSION = "0.8.14"

shutil.copy2(LOCK, BAK)
print("已备份原锁文件 ->", BAK)

lock = json.loads(LOCK.read_text(encoding="utf-8"))
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def sk_md_digest(p: Path) -> str:
    b = p.read_bytes()
    if b[:3] == b"\xef\xbb\xbf":
        b = b[3:]
    return hashlib.sha256(b.replace(b"\r\n", b"\n")).hexdigest()


def tree_digest(d: Path) -> str:
    """可复现的源树摘要（本仓库自定义算法，非 CLI 原生 source_tree_digest）"""
    h = hashlib.sha256()
    files = sorted([f for f in d.rglob("*") if f.is_file()],
                   key=lambda p: str(p.relative_to(d)).replace("\\", "/"))
    for f in files:
        rel = str(f.relative_to(d)).replace("\\", "/")
        h.update(rel.encode("utf-8"))
        h.update(b"\x00")
        h.update(hashlib.sha256(f.read_bytes()).hexdigest().encode())
        h.update(b"\x00")
    return h.hexdigest()


by_name = {s["skill"]: s for s in lock["skills"]}

# ---------- 1) 更新 CLI 升级导致漂移的 8 个 skill ----------
DRIFT = ["hyperframes", "hyperframes-core", "hyperframes-animation", "hyperframes-creative",
         "hyperframes-cli", "media-use", "hyperframes-audio", "hyperframes-registry"]
print("\n[1] 刷新漂移项的 sk_md_digest (CLI v0.8.10 -> v%s)" % CLI_VERSION)
for n in DRIFT:
    src = LOCAL / n / "SKILL.md"
    if not src.exists():
        print("    SKIP %-28s 源文件缺失" % n)
        continue
    e = by_name[n]
    old = e["sk_md_digest"]
    new = sk_md_digest(src)
    e["sk_md_digest"] = new
    e["previous_sk_md_digest"] = old
    e["digest_updated_at"] = now
    e["cli_version"] = CLI_VERSION
    e["source_tree_digest_stale"] = True  # CLI 内部算法，无法复现，保留原值仅供参考
    print("    %-28s %s -> %s" % (n, old[:12], new[:12]))

# hyperframes-keyframes 未漂移，仅补版本号
if "hyperframes-keyframes" in by_name:
    by_name["hyperframes-keyframes"]["cli_version"] = CLI_VERSION

# ---------- 2) 补录新条目 ----------
def entry(name, kind, src_root, src_dir, local_dir=None, note=None):
    d = src_root / src_dir
    e = {
        "skill": name,
        "repo_url": None,
        "kind": kind,
        "path": "SKILL.md",
        "source_tree_digest": tree_digest(d),
        "source_tree_digest_algorithm": "motion-tree-v1 (relpath+content-sha256 chain)",
        "sk_md_digest": sk_md_digest(d / "SKILL.md"),
        "entry_path": "SKILL.md",
        "installed_at": now,
    }
    if local_dir:
        e["local_dir"] = local_dir
    if note:
        e["note"] = note
    return e


print("\n[2] 补录未纳入锁文件的条目")
NEW = [
    ("hyperframes-media", "local_locked", LOCAL, "hyperframes-media",
     "~/.claude/skills/hyperframes-media",
     "HeyGen 官方原子技能（TTS/BGM/SFX 音频引擎，含 scripts/audio.mjs）；被 hyperframes-core/cli/animation 等 6 处引用，不可改名"),
    ("motion-design", "project", PROJ, "motion-design", ".agents/skills/motion-design",
     "项目内编排技能：镜头到动效的映射"),
    ("video-agency-roles", "project", PROJ, "video-agency-roles", ".agents/skills/video-agency-roles",
     "项目内编排技能：选题到成片的七层质量门"),
    ("motion-media-handoff", "project", PROJ, "hyperframes-media", ".agents/skills/hyperframes-media",
     "项目内编排技能：素材/音频/字幕/渲染交接门。原名 hyperframes-media，因与官方同名原子技能冲突而改名"),
]
for name, kind, root, sdir, ldir, note in NEW:
    if name in by_name:
        print("    SKIP %-28s 已存在" % name)
        continue
    e = entry(name, kind, root, sdir, ldir, note)
    lock["skills"].append(e)
    print("    + %-28s kind=%-13s sk_md=%s" % (name, kind, e["sk_md_digest"][:12]))

# ---------- 3) 顶层元信息 ----------
lock["digest_algorithm"] = {
    "sk_md_digest": "sha256( SKILL.md bytes after BOM-strip and CRLF->LF normalization )",
    "source_tree_digest": "CLI 原生算法，未公开；本文件新增条目改用 motion-tree-v1",
}
lock["cli"] = {"node": lock.get("cli", {}).get("node", "unknown"), "hyperframes": CLI_VERSION}
lock["last_updated_at"] = now
lock["last_updated_reason"] = (
    "同步 WorkBuddy 安装：hyperframes CLI 由 v0.8.10 升级至 v%s，8 个上游 skill 文档随之演进；"
    "补录官方 hyperframes-media 与 3 个项目内编排 skill（motion-design / video-agency-roles / motion-media-handoff）" % CLI_VERSION
)

LOCK.write_text(json.dumps(lock, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print("\n[3] 已写回 %s" % LOCK)
print("    条目总数: %d" % len(lock["skills"]))
