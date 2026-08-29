#!/usr/bin/env python3
"""逐镜提示词校验器（可选工具）

扫 `01_提示词/` 下的 `S*.md`，跑 prompt-templates 第 4、5 节里**可机器判定**的那几条。
解释型与展示型是两套模板，脚本先分流再查。
判不了的仍然要人工：视觉任务选得对不对、三层内容是否恰当、载体是不是真的形态各异、
旁白有没有逐字照抄 SRT、**这一镜该讲哪个知识点**、尾部**档位取得对不对**。
（知识点「是不是塞了两个」已由并列连词启发式初筛，尾部「有没有贴」已由 V8 判。）
判据不止来自 prompt-templates：R9 来自 style-library，R1b 与 storyboard-algorithm 第 10 节共用连词表。

它查的是**模板有没有被完整粘贴**，不是提示词写得好不好。
模板里那几句固定文本（硬性约束、反泄漏三行、锁定块两半、最低验收标准）
本来就要求原样带上，所以缺了就是漏了。

用法：
    python scripts/check_prompts.py <项目目录>
    python scripts/check_prompts.py <项目目录>/01_提示词
    python scripts/check_prompts.py <项目目录> --storyboard <项目目录>/storyboard.md

只读，不改任何文件。退出码 0 = 全过，1 = 有 FAIL，2 = 没找到可查的文件。
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

# 校验器共享的常量与读文件函数集中在 _lint_rules，副本一旦分家早晚会漏改。
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lint_rules import BANNED, CLIP_LENGTHS, read_text  # noqa: E402

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

VISUAL_TASKS = ("提问", "机制", "证据", "变化", "结论")

# 运镜库的代表词。只用来数「这一镜是不是安排了不止一个运镜」，命中多个报 warn。
CAMERA_MOVES = [
    "推进", "拉开", "环绕", "俯冲", "升起", "下降", "横移", "跟随", "焦点切换", "摇摄",
]


FENCE_RE = re.compile(r"^```[a-zA-Z]*\s*$", re.M)


def fences(md: str) -> list[str]:
    """取出所有围栏块的正文。奇数进偶数出，落单的最后一个丢掉。"""
    parts = FENCE_RE.split(md)
    return [p for i, p in enumerate(parts) if i % 2 == 1]


@dataclass
class Shot:
    path: Path
    sid: str                       # S01 / S05a
    num: int                       # 1 / 5
    md: str
    ref: str = ""                  # 参考图提示词围栏
    vid: str = ""                  # 视频提示词围栏
    blocks: list[str] = field(default_factory=list)


SID_RE = re.compile(r"^S(\d{2})([a-z]?)$")


def collect(root: Path) -> list[Shot]:
    d = root / "01_提示词" if (root / "01_提示词").is_dir() else root
    shots = []
    for p in sorted(d.glob("S*.md")):
        m = SID_RE.match(p.stem)
        if not m:
            continue
        md = read_text(p)
        blocks = fences(md)
        shot = Shot(p, p.stem, int(m.group(1)), md, blocks=blocks)
        # 参考图段在前、视频段在后。用特征词认，不靠顺序硬猜。
        for b in blocks:
            if not shot.ref and ("本镜视觉任务" in b or "参考关键帧" in b):
                shot.ref = b
            elif not shot.vid and ("开场状态" in b or "冻结的是外观" in b):
                shot.vid = b
        if not shot.ref and blocks:
            shot.ref = blocks[0]
        if not shot.vid and len(blocks) > 1:
            shot.vid = blocks[1]
        shots.append(shot)
    return shots


class Report:
    def __init__(self) -> None:
        self.rows: list[tuple[str, str, str]] = []

    def add(self, status: str, rule: str, detail: str = "") -> None:
        self.rows.append((status, rule, detail))

    def emit(self) -> int:
        fails = sum(r[0] == "FAIL" for r in self.rows)
        warns = sum(r[0] == "warn" for r in self.rows)
        width = max(len(r[1]) for r in self.rows) if self.rows else 0
        for status, rule, detail in self.rows:
            if status == "ok" and not detail:
                continue
            mark = {"FAIL": "FAIL", "warn": "warn", "skip": "skip", "ok": "  ok"}[status]
            print(f"{mark}  {rule:<{width}}  {detail}")
        if not fails and not warns:
            print("干净。")
        print(f"\n{len(self.rows)} 项，{fails} FAIL，{warns} warn。")
        print("判不了的（视觉任务选得对不对、三层是否恰当、载体是否真的各异、"
              "旁白是否逐字照抄）仍要人工过。")
        return 1 if fails else 0


def has_all(text: str, *needles: str) -> list[str]:
    return [n for n in needles if n not in text]


SKILL_ROOT = Path(__file__).resolve().parent.parent
_BLOCK_CACHE: dict[str, list[str]] = {}


def style_block(sid: str) -> list[str]:
    """取 style-library 里某条风格的围栏正文，按非空行返回。取不到返回空表。"""
    if sid in _BLOCK_CACHE:
        return _BLOCK_CACHE[sid]
    lib = SKILL_ROOT / "references" / "style-library.md"
    if not lib.is_file():
        _BLOCK_CACHE[sid] = []
        return []
    md = read_text(lib)
    m = re.search(rf"^## {sid} .*?$(.*?)(?=^## S\d{{2}} |\Z)", md, re.S | re.M)
    body = fences(m.group(1)) if m else []
    lines = [l.strip() for l in (body[0] if body else "").split("\n") if l.strip()]
    _BLOCK_CACHE[sid] = lines
    return lines


def squash(text: str) -> str:
    return re.sub(r"\s+", "", text)


def check_styleblock(s: Shot, rep: Report) -> None:
    """风格块必须整段原样取用。截掉「配色角色」「三层纵深」两栏，
    这条风格自己的三层约束就整条消失——模板里的通用兜底句救不回具体的前景物件清单。"""
    m = re.search(r"style-board[/\\](S\d{2})", s.md)
    if not m:
        rep.add("skip", f"{s.sid} R9 风格块整段原样", "文件里没有风格板路径，认不出 style_id")
        return
    want = style_block(m.group(1))
    if not want:
        rep.add("skip", f"{s.sid} R9 风格块整段原样", f"style-library 里找不到 {m.group(1)}")
        return
    got = squash(s.ref)
    missing = [l for l in want if squash(l) not in got]
    if missing:
        head = missing[0][:28] + ("…" if len(missing[0]) > 28 else "")
        rep.add("FAIL", f"{s.sid} R9 风格块整段原样",
                f"缺 {len(missing)}/{len(want)} 行，首条：{head}")
    else:
        rep.add("ok", f"{s.sid} R9 风格块整段原样")


def check_ref(s: Shot, rep: Report) -> None:
    """参考图提示词段。缺的都是模板里要求原样带上的固定文本。"""
    t = s.ref
    if not t:
        rep.add("FAIL", f"{s.sid} R0 有参考图提示词围栏", "没找到 ```text 块")
        return

    miss = has_all(t, "本镜旁白", "本镜视觉任务", "本镜知识点")
    rep.add("FAIL" if miss else "ok", f"{s.sid} R1 旁白·视觉任务·知识点", "缺：" + "、".join(miss) if miss else "")

    # 一镜一个知识点。判据与 storyboard-algorithm 第 10 节同源。
    if "本镜知识点" in t:
        kl = next((l for l in t.split("\n") if "本镜知识点" in l), "")
        joiners = [j for j in ("并且", "同时", "以及", "而且") if j in kl]
        rep.add("FAIL" if joiners else "ok", f"{s.sid} R1b 一镜一个知识点",
                "含并列连词：" + "、".join(joiners) if joiners else "")

    if "本镜视觉任务" in t:
        line = next((l for l in t.split("\n") if "本镜视觉任务" in l), "")
        hit = [v for v in VISUAL_TASKS if v in line]
        rep.add("FAIL" if len(hit) != 1 else "ok", f"{s.sid} R2 视觉任务恰好一类",
                f"命中 {len(hit)} 个：{line.strip()}" if len(hit) != 1 else "")

    miss = has_all(t, "前景", "中景", "背景")
    rep.add("FAIL" if miss else "ok", f"{s.sid} R3 三层齐全", "缺：" + "、".join(miss) if miss else "")

    # 三层的固定约束句。光写「前景：某物」模型做不出纵深，
    # 三层退化成一行横向排列是出图第一常见的失败。
    miss = has_all(t, "空间距离", "对焦清晰", "画面深处")
    rep.add("FAIL" if miss else "ok", f"{s.sid} R3b 三层带固定约束句",
            "缺：" + "、".join(miss) if miss else "")

    miss = has_all(t, "连接元素", "视觉焦点：")
    rep.add("FAIL" if miss else "ok", f"{s.sid} R3c 连接元素与视觉焦点",
            "缺：" + "、".join(n.rstrip("：") for n in miss) if miss else "")

    # 图生视频专用的两条，静态图看不出问题也必须写
    miss = has_all(t, "只有一个清晰的视觉焦点", "主体数量精确", "三层分明",
                   "没有运动模糊", "轮廓不断裂", "不出现重复主体", "不得复现某一帧已发布的画面")
    rep.add("FAIL" if miss else "ok", f"{s.sid} R4 硬性约束七条", "缺：" + "、".join(miss) if miss else "")

    # 底部横带是模板里最长的固定文本之一，整段被删掉时四条禁用措辞正则一声不吭
    ok10 = "只有背景本身继续延伸" in t
    rep.add("ok" if ok10 else "FAIL", f"{s.sid} R10 底部横带段",
            "" if ok10 else "缺「这条带子里只有背景本身继续延伸…」整段")

    miss = has_all(t, "随附的风格板", "不复制", "不是样板")
    rep.add("FAIL" if miss else "ok", f"{s.sid} R5 反泄漏三行", "缺：" + "、".join(miss) if miss else "")

    rep.add("FAIL" if "只渲染" not in t else "ok", f"{s.sid} R6 只渲染指定文字",
            "缺「只渲染上面指定的文字」" if "只渲染" not in t else "")

    # 带字载体写成「尚在画外」＝ 把造字任务交给视频模型
    for line in t.split("\n"):
        if "画外" in line and re.search(r"带字|文字|标题|标签|字块|卡片", line) and "无字" not in line:
            rep.add("FAIL", f"{s.sid} R7 带字载体不得在画外", line.strip()[:60])
            break
    else:
        rep.add("ok", f"{s.sid} R7 带字载体不得在画外")

    # 精确数量要正反两说
    if re.search(r"恰好\s*[一二三四五六七八九十\d]+", t):
        neg = re.search(r"不(要|得)(出现|添加|新增).*第二|不(要|得)出现更多|不得添加第", t)
        rep.add("ok" if neg else "warn", f"{s.sid} R8 精确数量正反两说",
                "只有正说，缺配套的否定句" if not neg else "")


def is_display(t: str) -> bool:
    """展示型走的是第 5 节末尾那套模板，特征是机位固定＋读字保护区。"""
    return "读字保护区" in t or ("机位固定" in t and "低运动强度" in t)


# 与新帧模型冲突、绝不允许出现在视频提示词里的声明。
# 新模型下上传图是垫图、模型重新生成第 0 帧；任何「上传图就是第一帧/第 0 帧」
# 的宣告都与实际行为冲突，会让模型困惑。纯字符串匹配，最适合机器守。
DELETED_DECL = (
    "上传的这张图就是精确的第一帧",
    "画面从它原样起步",
    "上传图就是第 0 帧",
    "上传图就是第一帧",
    "上传的这张图就是第 0 帧",
    "这张图就是生成片段的第 0 帧",
)


def check_vid(s: Shot, rep: Report) -> None:
    """视频提示词段。解释型与展示型是两套模板，先分流再查。"""
    t = s.vid
    if not t:
        rep.add("FAIL", f"{s.sid} V0 有视频提示词围栏", "没找到第二个 ```text 块")
        return
    disp = is_display(t)

    back = [d for d in DELETED_DECL if d in t]
    rep.add("FAIL" if back else "ok", f"{s.sid} V0b 残留的第一帧声明",
            "出现：" + "、".join(back) if back else "")

    has_freeze, has_free = "冻结" in t, "放开" in t
    if has_freeze and has_free:
        rep.add("ok", f"{s.sid} V1 锁定块拆冻结/放开两半")
    else:
        lump = re.search(r"(全部|所有).{0,12}与(图中|参考图里?)完全一致", t)
        rep.add("FAIL", f"{s.sid} V1 锁定块拆冻结/放开两半",
                "写成了笼统的「与图中/参考图里完全一致」" if lump else
                f"缺{'冻结' if not has_freeze else ''}{'放开' if not has_free else ''}那一半")

    miss = has_all(t, "本镜旁白", "画面对齐目标")
    rep.add("FAIL" if miss else "ok", f"{s.sid} V2b 旁白与声画对齐目标",
            "缺：" + "、".join(miss) if miss else "")

    # 时长写在首行。用 (?<![\d.]) 挡住「2.0 秒」这类动作时间码的小数位。
    head = t.strip().split("\n", 1)[0]
    nums = {int(m) for m in re.findall(r"(?<![\d.])(\d+)\s*秒", head)}
    if nums and not (nums & CLIP_LENGTHS):
        rep.add("FAIL", f"{s.sid} V5 生成时长 ∈ {{4,6,8,10}}",
                f"首行写的是 {'、'.join(str(n) for n in sorted(nums))} 秒")
    elif not nums:
        rep.add("warn", f"{s.sid} V5 生成时长 ∈ {{4,6,8,10}}", "首行没写生成时长")
    else:
        rep.add("ok", f"{s.sid} V5 生成时长 ∈ {{4,6,8,10}}")

    miss = has_all(t, "不要音乐", "不要旁白", "不要人声", "不要歌词")
    rep.add("FAIL" if miss else "ok", f"{s.sid} V7 声音排除项四条",
            "缺：" + "、".join(miss) if miss else "")

    # 选哪一档判不了，有没有贴是纯字符串判定。
    # 七段可粘贴文本里前六段都含「保持完全静止」，拆分镜上游那段用「精确停在桥接帧」。
    tail = "保持完全静止" in t or "精确停在桥接帧" in t
    rep.add("FAIL" if not tail else "ok", f"{s.sid} V8 尾部契约文本已贴",
            "视频段没有尾部段——模型会在末段自行发挥" if not tail else "")

    if disp:
        miss = has_all(t, "读字保护区", "定格", "任何时刻都不得出现新的文字")
        rep.add("FAIL" if miss else "ok", f"{s.sid} D1 展示型固定文本",
                "缺：" + "、".join(miss) if miss else "")
        rep.add("FAIL" if "入场" not in t else "ok", f"{s.sid} D2 入场段",
                "缺入场时间码" if "入场" not in t else "")
        return

    miss = has_all(t, "主要动作", "焦点：")
    rep.add("FAIL" if miss else "ok", f"{s.sid} V2c 主要动作与焦点转移",
            "缺：" + "、".join(n.rstrip("：") for n in miss) if miss else "")

    rep.add("FAIL" if "三个主要部件" not in t else "ok", f"{s.sid} V3 最低验收标准",
            "缺「至少三个主要部件…物理位移」" if "三个主要部件" not in t else "")

    rep.add("FAIL" if "单个字符" not in t else "ok", f"{s.sid} V4 禁止逐字动画",
            "缺「不得对单个字符做动画」" if "单个字符" not in t else "")

    if "不做第二次转向" not in t:
        rep.add("FAIL", f"{s.sid} V6 运镜只选一个",
                "缺「不做第二次转向、不切镜、不叠加第二种运镜」")
    else:
        cam_line = next((l for l in t.split("\n") if l.strip().startswith("运镜")), "")
        # 解释型镜头误写「机位固定」＝把展示型规则用错地方，等于没选运镜。
        # 展示型在 if disp 分支已 return，走到这里的都是解释型。
        # 只查首行（第一个非空行）+ 运镜行：作为机位描述/运镜选择才会写在这两处；
        # 不查整个 t，因为尾部契约表的可粘贴静止文本含「机位不动」，那不是运镜选择。
        head_line = next((l for l in t.split("\n") if l.strip()), "")
        fixed = re.search(r"机位固定(?:不动)?|机位(?:保持|不动|锁定)", cam_line) or \
                re.search(r"机位固定(?:不动)?|机位(?:保持|不动|锁定)", head_line)
        if not disp and fixed:
            rep.add("FAIL", f"{s.sid} V6 运镜只选一个",
                    "解释型镜头误写「机位固定」——那是展示型的规则，解释型必须从运镜库选一个真正会动的机位（prompt-motion 第 4 节）")
        else:
            hits = [c for c in CAMERA_MOVES if c in cam_line]
            rep.add("warn" if len(hits) > 1 else "ok", f"{s.sid} V6 运镜只选一个",
                    f"约束在，但运镜行里命中 {len(hits)} 个：{'、'.join(hits)}" if len(hits) > 1 else "")

    # 带字载体从画外飞入＝让视频模型造字。动作清单在视频段，这里才是它真正会写的地方。
    for line in t.split("\n"):
        if "画外" in line and re.search(r"带字|文字|标题|标签|字块|文字卡", line) and "无字" not in line:
            rep.add("FAIL", f"{s.sid} V9 带字载体不得从画外飞入", line.strip()[:60])
            break
    else:
        rep.add("ok", f"{s.sid} V9 带字载体不得从画外飞入")


LEDGER_FIELDS = ("角色", "载体", "类别", "材质", "层级", "位置", "对比", "动作", "路线")


def check_ledger(s: Shot, rep: Report) -> None:
    """关键词台账的字段不得改名、合并或省略。
    文档自己记着：早期版本把材质/层级/位置/对比揉成一个「处理」字段，层级和对比就丢在那一揉里了。"""
    led = next((b for b in s.blocks if "角色：" in b and "载体：" in b), "")
    if not led:
        rep.add("skip", f"{s.sid} L0 有关键词台账块", "文件里没有台账围栏")
        return
    miss = [f for f in LEDGER_FIELDS if f + "：" not in led]
    rep.add("FAIL" if miss else "ok", f"{s.sid} L1 台账字段齐全",
            "缺：" + "、".join(miss) if miss else "")
    rep.add("FAIL" if "仅后期内容" not in led else "ok", f"{s.sid} L2 有「仅后期内容」行",
            "缺整镜级的「仅后期内容」行（注意它不是「仅后期」）" if "仅后期内容" not in led else "")
    cats = set(re.findall(r"类别：\s*(嵌入|粘贴|立牌|悬挂)", led))
    n_car = led.count("载体：")
    bad = n_car >= 3 and len(cats) < 2
    rep.add("FAIL" if bad else "ok", f"{s.sid} L3 ≥3 个载体覆盖 ≥2 类别",
            f"{n_car} 个载体只用了 {len(cats)} 个类别" if bad else "")


def check_banned(s: Shot, rep: Report) -> None:
    """围栏内不得出现版式术语。围栏外是给人看的说明，不扫。"""
    hits = []
    for b in s.blocks:
        for pat, why in BANNED:
            m = pat.search(b)
            if m:
                hits.append(f"「{m.group(0)}」{why}")
    rep.add("FAIL" if hits else "ok", f"{s.sid} B  提示词无版式术语", "；".join(dict.fromkeys(hits)))


def check_board_path(shots: list[Shot], rep: Report) -> None:
    """风格板路径要写进每一镜，且全片同一张。"""
    found: dict[str, list[str]] = {}
    missing = []
    for s in shots:
        m = re.search(r"style-board[/\\](S\d{2})", s.md)
        if m:
            found.setdefault(m.group(1), []).append(s.sid)
        else:
            missing.append(s.sid)
    rep.add("FAIL" if missing else "ok", "X1 每镜都写了风格板路径",
            "缺：" + "、".join(missing) if missing else "")
    if len(found) > 1:
        detail = "；".join(f"{k}→{'、'.join(v)}" for k, v in found.items())
        rep.add("FAIL", "X2 全片风格板同一张", detail)
    elif found:
        rep.add("ok", "X2 全片风格板同一张")


def _count_storyboard_body(md: str) -> int:
    """数分镜表正文行数，与 check_storyboard.find_table 同判据。

    合计行之后还可能有规模提示表（delivery-contract §4），那几张表的行
    长得跟正文行一样，必须停在「合计」或表格中断，否则会把规模表的行误数成镜头。
    """
    lines = md.split("\n")
    for i, line in enumerate(lines):
        if "|" not in line:
            continue
        header = [c.strip() for c in line.strip().strip("|").split("|")]
        if "镜号" not in header:
            continue
        if i + 1 >= len(lines) or not set(lines[i + 1].replace("|", "").strip()) <= set("-: "):
            continue
        n = 0
        for body in lines[i + 2:]:
            if "|" not in body or not body.strip():
                break
            cells = [c.strip() for c in body.strip().strip("|").split("|")]
            if cells and cells[0].startswith("合计"):
                break
            n += 1
        return n
    return 0


def check_numbering(shots: list[Shot], sb: Path | None, rep: Report) -> None:
    nums = sorted({s.num for s in shots})
    gaps = [n for n in range(nums[0], nums[-1] + 1) if n not in nums]
    rep.add("FAIL" if gaps else "ok", "X3 镜号连续无缺口",
            "缺 " + "、".join(f"S{n:02d}" for n in gaps) if gaps else "")

    if sb is None:
        rep.add("skip", "X4 镜数与分镜表一致", "未提供 --storyboard")
        return
    # 只数分镜表本身的正文行：跳过分隔行，停在「合计」行或表格中断。
    # 不能数整个文件里所有以 | 开头的行——合计行之后还可能有规模提示表
    # （见 delivery-contract §4），那几张表的行长得跟正文行一样，会被误数成镜头。
    n_sb = _count_storyboard_body(read_text(sb))
    rep.add("FAIL" if n_sb != len(nums) else "ok", "X4 镜数与分镜表一致",
            f"分镜表 {n_sb} 行，提示词 {len(nums)} 镜" if n_sb != len(nums) else "")


def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        return 2
    root = Path(args[0])
    sb = None
    if "--storyboard" in argv:
        i = argv.index("--storyboard")
        if i + 1 < len(argv):
            sb = Path(argv[i + 1])
    if sb is None and (root / "storyboard.md").is_file():
        sb = root / "storyboard.md"

    shots = collect(root)
    if not shots:
        print(f"在 {root} 下没找到 01_提示词/S*.md。")
        print("目录结构见 delivery-contract.md 第 8 节。")
        return 2

    print(f"提示词目录：{root}")
    print(f"解析到 {len(shots)} 个镜头文件：{'、'.join(s.sid for s in shots)}\n")

    rep = Report()
    for s in shots:
        check_ref(s, rep)
        check_ledger(s, rep)
        check_styleblock(s, rep)
        check_vid(s, rep)
        check_banned(s, rep)
    check_board_path(shots, rep)
    check_numbering(shots, sb, rep)
    return rep.emit()


if __name__ == "__main__":
    sys.exit(main(sys.argv))
