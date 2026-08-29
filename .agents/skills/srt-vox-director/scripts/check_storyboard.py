#!/usr/bin/env python3
"""分镜表校验器（可选工具）

跑 storyboard-algorithm.md 第 11 节里可机器判定的那几条。
知识点「是不是塞了两个」已由并列连词启发式初筛（4c/4d），但**这一镜该讲哪个知识点**
仍要人工；同样判不了的还有定型是否恰当、视觉任务选得对不对、转场锚点能否衔接。

用法：
    python scripts/check_storyboard.py <项目目录>/storyboard.md <字幕>.srt
    python scripts/check_storyboard.py <项目目录>/storyboard.md          # 跳过需要 SRT 的检查
    python scripts/check_storyboard.py <项目目录>/storyboard.md <字幕>.srt minimal   # 第三参数＝文字密度，默认 standard

只读，不改任何文件。退出码 0 = 全过，1 = 有 FAIL。
"""

from __future__ import annotations

import re
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

# 校验器共享的常量集中在 _lint_rules，副本一旦分家早晚会漏改。
# 本文件的 read_text 返回 (text, enc) 元组、签名不同，仍自带，不并进去。
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lint_rules import CLIP_LENGTHS, DENSITY_CAP, ENCODINGS  # noqa: E402

# Windows 控制台默认 GBK，输出里的中文与 − 符号会炸；强制 UTF-8。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

VISUAL_TASKS = {"question", "mechanism", "evidence", "change", "conclusion"}
DISPLAY_CARD_CAP = 8


# ---------------------------------------------------------------- 读文件


def read_text(path: Path) -> tuple[str, str]:
    """按 storyboard-algorithm 第 1 节的顺序试编码，返回 (文本, 用了哪个编码)。"""
    raw = path.read_bytes()
    for enc in ENCODINGS:
        try:
            text = raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
        if text.count("�") == 0:
            return text.replace("\r\n", "\n"), enc
    return raw.decode("utf-8", errors="replace").replace("\r\n", "\n"), "utf-8(replace)"


# ---------------------------------------------------------------- SRT


@dataclass
class Cue:
    index: int
    start: float
    end: float
    raw_text: str
    clean_text: str


TIME_RE = re.compile(r"(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})")
ARROW_RE = re.compile(r"-->")
TAG_RE = re.compile(r"<[^>]+>|\{\\[^}]*\}")
NOTE_RE = re.compile(r"[\[［][^\]］]*[\]］]|[（(][^）)]{0,8}[）)]")
SPEAKER_RE = re.compile(r"^\s*(?:-\s+|[一-龥A-Za-z0-9]{1,8}[:：])")


def parse_time(m: re.Match) -> float:
    h, mi, s, ms = m.groups()
    return int(h) * 3600 + int(mi) * 60 + int(s) + int(ms.ljust(3, "0")) / 1000


def clean_line(line: str) -> str:
    line = TAG_RE.sub("", line)
    line = NOTE_RE.sub("", line)
    line = SPEAKER_RE.sub("", line)
    return line.strip()


def parse_srt(text: str) -> list[Cue]:
    text = text.lstrip("﻿")
    if text.lstrip().upper().startswith("WEBVTT"):
        text = "\n".join(
            l for l in text.split("\n") if not l.strip().upper().startswith(("WEBVTT", "NOTE"))
        )

    cues: list[Cue] = []
    for block in re.split(r"\n\s*\n", text):
        lines = [l for l in block.split("\n") if l.strip()]
        if not lines:
            continue
        time_idx = next((i for i, l in enumerate(lines) if ARROW_RE.search(l)), None)
        if time_idx is None:
            continue
        stamps = TIME_RE.findall(lines[time_idx])
        marks = list(TIME_RE.finditer(lines[time_idx]))
        if len(marks) < 2:
            continue
        body = lines[time_idx + 1 :]
        raw = " ".join(body).strip()
        clean = " ".join(filter(None, (clean_line(l) for l in body))).strip()
        if not clean:
            continue  # 空文本条目并入前一镜的静默
        if cues and cues[-1].clean_text == clean:
            cues[-1].end = parse_time(marks[1])  # 相邻重复，合并
            continue
        cues.append(
            Cue(len(cues) + 1, parse_time(marks[0]), parse_time(marks[1]), raw, clean)
        )
    return cues


# ---------------------------------------------------------------- 分镜表


@dataclass
class Shot:
    row: int
    shot_id: str
    kind: str
    cue_range: str
    natural: float | None
    generated: int | None
    delta_kind: str | None       # 余量 / 补差 / 0
    delta_value: float | None
    visual_task: str
    knowledge: str
    keywords: str
    mark: str
    cells: dict[str, str] = field(default_factory=dict)


HEADER_KEYS = ("镜号", "型", "自然时长", "生成时长", "差值")
NUM_RE = re.compile(r"-?\d+(?:\.\d+)?")


def split_row(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def find_table(md: str) -> tuple[list[str], list[list[str]]] | None:
    lines = md.split("\n")
    for i, line in enumerate(lines):
        if "|" not in line:
            continue
        header = split_row(line)
        if not all(k in header for k in HEADER_KEYS):
            continue
        if i + 1 >= len(lines) or not set(lines[i + 1].replace("|", "").strip()) <= set("-: "):
            continue
        rows = []
        for body in lines[i + 2 :]:
            if "|" not in body or not body.strip():
                break
            cells = split_row(body)
            if cells and cells[0].startswith("合计"):
                break
            rows.append(cells)
        return header, rows
    return None


def first_num(text: str) -> float | None:
    m = NUM_RE.search(text)
    return float(m.group()) if m else None


def last_num(text: str) -> float | None:
    nums = NUM_RE.findall(text)
    return float(nums[-1]) if nums else None


def parse_shots(header: list[str], rows: list[list[str]]) -> tuple[list[Shot], list[str]]:
    idx = {name: i for i, name in enumerate(header)}
    shots, problems = [], []
    for n, cells in enumerate(rows, start=1):
        if len(cells) != len(header):
            problems.append(f"第 {n} 行列数 {len(cells)}，表头是 {len(header)}")
            continue

        def cell(name: str) -> str:
            return cells[idx[name]] if name in idx else ""

        delta_text = cell("差值")
        if "余量" in delta_text:
            dk, dv = "余量", first_num(delta_text)
        elif "补差" in delta_text:
            dk, dv = "补差", -(first_num(delta_text) or 0)
        elif delta_text.strip() in {"0", "0s", "0.0s", "—", "-"}:
            dk, dv = "0", 0.0
        else:
            dk, dv = None, None
            problems.append(f"{cell('镜号') or f'第 {n} 行'} 的差值列无法解析：{delta_text!r}")

        gen = last_num(cell("生成时长"))
        shots.append(
            Shot(
                row=n,
                shot_id=cell("镜号"),
                kind="展示" if "展示" in cell("型") else ("解释" if "解释" in cell("型") else ""),
                cue_range=cell("字幕区间"),
                natural=first_num(cell("自然时长")),
                generated=int(gen) if gen is not None else None,
                delta_kind=dk,
                delta_value=dv,
                visual_task=cell("视觉任务"),
                knowledge=cell("知识点"),
                keywords=cell("精确关键词"),
                mark=cell("标记"),
                cells={h: c for h, c in zip(header, cells)},
            )
        )
    return shots, problems


# ---------------------------------------------------------------- 字块


CJK = r"㐀-䶿一-鿿豈-﫿぀-ヿ"
BLOCK_RE = re.compile(rf"[{CJK}]|[A-Za-z][A-Za-z0-9_\-]*|\d+(?:\.\d+)?%?[A-Za-z]*")


def count_blocks(text: str) -> int:
    """印刷字块：汉字 1 块，英文单词/标识符 1 块，数字含单位 1 块，标点不计。"""
    return len(BLOCK_RE.findall(text))


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).lower()
    return "".join(ch for ch in text if not unicodedata.category(ch).startswith(("P", "Z", "C")))


def is_subsequence(needle: str, haystack: str) -> bool:
    it = iter(haystack)
    return all(ch in it for ch in needle)


# ---------------------------------------------------------------- 检查


class Report:
    def __init__(self) -> None:
        self.rows: list[tuple[str, str, str]] = []

    def add(self, status: str, rule: str, detail: str = "") -> None:
        self.rows.append((status, rule, detail))

    def emit(self) -> int:
        width = max(len(r) for _, r, _ in self.rows)
        failed = 0
        for status, rule, detail in self.rows:
            print(f"[{status:4}] {rule.ljust(width)}  {detail}")
            failed += status == "FAIL"
        print()
        print(f"{len(self.rows)} 项机器检查，{failed} 项 FAIL。")
        print("定型是否恰当、这一镜该讲哪个知识点、视觉任务选得对不对、转场锚点能否衔接——")
        print("这四类机器判不了，仍要按 storyboard-algorithm 第 11 节人工过。")
        return 1 if failed else 0


def check(shots: list[Shot], cues: list[Cue], density: str, rep: Report) -> None:
    # ---- 1 枚举类：填错值会让下游若干条静默失效，属于最便宜的一批检查 ----
    bad = [sh.shot_id or f"第{sh.row}行" for sh in shots if sh.kind not in ("解释", "展示")]
    rep.add("FAIL" if bad else "ok", "1  `型` ∈ {解释, 展示}",
            "填了别的值，5d/7/7b/9 会对这些镜静默跳过：" + "、".join(bad) if bad else "")

    bad = [sh.shot_id for sh in shots if not re.fullmatch(r"S\d{2}[a-z]?", sh.shot_id or "")]
    rep.add("FAIL" if bad else "ok", "1b 镜号形如 S01 / S05a", "、".join(bad))

    ROUTES = ("generated", "blank carrier + overlay", "post only")
    bad = []
    for sh in shots:
        v = sh.cells.get("文字路线", "").strip()
        if v and v not in ROUTES:
            bad.append(f"{sh.shot_id}（{v}）")
    rep.add("FAIL" if bad else "ok", "1c `文字路线` 是三个合法值之一",
            "拼错会让 7b 的豁免失效：" + "、".join(bad) if bad else "")

    # ---- 5e 短镜双向 + 余量上限 ----
    bad = [sh.shot_id for sh in shots
           if sh.natural is not None and sh.natural < 3.0 and "短镜" not in sh.mark]
    rep.add("FAIL" if bad else "ok", "5e 自然时长 < 3s 必须标 `短镜`", "、".join(bad))

    bad = [f"{sh.shot_id}（余量 {sh.delta_value}）" for sh in shots
           if "短镜" in sh.mark and sh.delta_kind == "余量"
           and sh.delta_value is not None and sh.delta_value > 3.2]
    rep.add("FAIL" if bad else "ok", "5f 短镜余量 ≤ 3.2s", "、".join(bad))

    # ---- 7c 展示型自然时长 > 15s 必须按内容分成两个展示镜 ----
    bad = [f"{sh.shot_id}（{sh.natural}s）" for sh in shots
           if sh.kind == "展示" and sh.natural is not None and sh.natural > 15.0]
    rep.add("warn" if bad else "ok", "7c 展示型 > 15s 应分成两个展示镜",
            "回查第 2 节例外 a：" + "、".join(bad) if bad else "")

    # 2 生成时长落档
    bad = [s.shot_id for s in shots if s.generated not in CLIP_LENGTHS]
    rep.add("FAIL" if bad else "ok", "2  生成时长 ∈ {4,6,8,10}", "越界：" + "、".join(bad) if bad else "")

    # 4b 视觉任务五类之一
    bad = []
    for s in shots:
        tokens = re.findall(r"[a-z]+", s.visual_task.lower())
        if not any(tok in VISUAL_TASKS for tok in tokens):
            bad.append(f"{s.shot_id}({s.visual_task})")
    rep.add("FAIL" if bad else "ok", "4b 视觉任务是五类之一", "、".join(bad))

    # 知识点：三级优先级第一条硬约束的唯一书面记录。
    # 「需要用『并且』才能描述就是两个」这条判据，第 1 节判视觉任务时已经在用。
    empty = [sh.shot_id for sh in shots if not sh.knowledge.strip()]
    rep.add("FAIL" if empty else "ok", "4c 知识点非空", "、".join(empty))
    JOINERS = ("并且", "同时", "以及", "而且")
    two = [f"{sh.shot_id}（{j}）" for sh in shots for j in JOINERS if j in sh.knowledge]
    rep.add("FAIL" if two else "ok", "4d 一镜一个知识点", "含并列连词：" + "、".join(two) if two else "")

    # 5 差值 = 生成 − 自然，且自然 ≥ 3 时 |差值| ≤ 1.0
    mismatch, over, badmark = [], [], []
    for s in shots:
        if None in (s.natural, s.generated, s.delta_value):
            continue
        if abs((s.generated - s.natural) - s.delta_value) > 0.051:
            mismatch.append(f"{s.shot_id}(表 {s.delta_value:+.1f}，算 {s.generated - s.natural:+.1f})")
        # 例外一：短镜。标记不是免检通道——自然时长必须真的 < 3.0
        is_short = "短镜" in s.mark and s.natural < 3.0
        if "短镜" in s.mark and s.natural >= 3.0:
            badmark.append(f"{s.shot_id}(自然 {s.natural}s ≥ 3.0，不是短镜)")
        # 例外二：展示型封顶。门槛是 > 11 不是 > 10——(10,11] 取 10 时补差最多 1.0，本就不用豁免
        is_display_cap = s.kind == "展示" and s.natural > 11
        if s.natural >= 3.0 and abs(s.delta_value) > 1.05 and not (is_short or is_display_cap):
            over.append(f"{s.shot_id}({s.delta_value:+.1f})")
    rep.add("FAIL" if mismatch else "ok", "5a 差值 = 生成 − 自然", "、".join(mismatch))
    rep.add("FAIL" if over else "ok", "5b 自然 ≥ 3s ⟹ |差值| ≤ 1.0", "、".join(over))
    rep.add("FAIL" if badmark else "ok", "5c `短镜` 标记名副其实", "、".join(badmark))

    # 5d 解释型也必须取就近档（原来只查展示型，5.0/7.0/9.0 与短镜是漏洞）
    bad = []
    for s in shots:
        if s.kind != "解释" or None in (s.natural, s.generated):
            continue
        if s.natural > 11:
            continue                      # 该拆分，由第 7 条与人工判
        want = min(CLIP_LENGTHS, key=lambda c: (abs(c - s.natural), c))
        if s.generated != want:
            bad.append(f"{s.shot_id} 自然 {s.natural}s 取了 {s.generated}s，就近档是 {want}s")
    rep.add("FAIL" if bad else "ok", "5d 解释型取的是就近档", "、".join(bad))

    # 7 展示型未拆分、取最接近档
    bad = []
    for s in shots:
        if s.kind != "展示":
            continue
        if "拆分" in s.mark:
            bad.append(f"{s.shot_id} 被拆分")
        elif s.natural is not None and s.generated is not None:
            want = 10 if s.natural > 10 else min(CLIP_LENGTHS, key=lambda c: (abs(c - s.natural), c))
            if s.generated != want:
                bad.append(f"{s.shot_id} 取了 {s.generated}s，最接近档是 {want}s")
    rep.add("FAIL" if bad else "ok", "7  展示型不拆分、取最接近档", "、".join(bad))

    # 9a/9b 文字数上限
    cap = DENSITY_CAP.get(density, DENSITY_CAP["standard"])
    bad = []
    for s in shots:
        items = [x for x in re.split(r"[、,，;；/|]| {2,}", s.keywords) if x.strip()]
        limit = DISPLAY_CARD_CAP if s.kind == "展示" else cap
        if len(items) > limit:
            bad.append(f"{s.shot_id}({len(items)}>{limit})")
        for it in items:
            if count_blocks(it) > 14:
                bad.append(f"{s.shot_id} 有 {count_blocks(it)} 字块的项：{it[:12]}…")
    rep.add("FAIL" if bad else "ok", f"9  文字上限（解释型 {density}={cap}，展示型 {DISPLAY_CARD_CAP}）", "、".join(bad))

    # 11 差值率
    explain = [s for s in shots if s.kind == "解释" and s.delta_value is not None and s.generated]
    if explain:
        rate = sum(abs(s.delta_value) for s in explain) / sum(s.generated for s in explain)
        note = f"{rate:.1%}"
        if rate > 0.20:
            note += "  > 20%，必须已向用户提示三个选项"
        rep.add("warn" if rate > 0.20 else "ok", "11 差值率", note)
    else:
        rep.add("warn", "11 差值率", "没有可计算的解释型镜")

    # 3 区间无缝覆盖 + 7b 展示型逐字覆盖（需要 SRT）
    if not cues:
        rep.add("skip", "3  镜头区间无缝覆盖时间轴", "未提供 SRT")
        rep.add("skip", "7b 展示型上屏文字完整覆盖旁白", "未提供 SRT")
        return

    covered, gaps = set(), []
    for s in shots:
        nums = [int(x) for x in re.findall(r"\d+", s.cue_range)]
        if not nums:
            gaps.append(f"{s.shot_id} 字幕区间为空")
            continue
        lo, hi = nums[0], nums[-1]
        for i in range(lo, hi + 1):
            if i in covered:
                gaps.append(f"字幕 {i} 被 {s.shot_id} 重复覆盖")
            covered.add(i)
    missing = sorted(set(range(1, len(cues) + 1)) - covered)
    if missing:
        gaps.append("未覆盖字幕：" + ", ".join(map(str, missing[:12])) + ("…" if len(missing) > 12 else ""))
    # ---- 1d 自然时长与 SRT 对账 ----
    # 第 1 节的公式是完全确定的，而自然时长是 5a/5b/5d/7 的共同输入。
    # 填错它会连锁污染四条，且报出来的诊断（「|差值| ≤ 1.0」）指向的是错误的方向。
    starts = []
    for sh in shots:
        rng = normalize(sh.cue_range)
        m = re.match(r"(\d+)", rng)
        starts.append(int(m.group(1)) if m else None)
    bad = []
    for i, sh in enumerate(shots):
        if starts[i] is None or sh.natural is None:
            continue
        j = starts[i] - 1
        if not (0 <= j < len(cues)):
            continue
        if i + 1 < len(shots) and starts[i + 1] is not None and 0 <= starts[i + 1] - 1 < len(cues):
            want = cues[starts[i + 1] - 1].start - cues[j].start
        elif i + 1 == len(shots):
            want = cues[-1].end - cues[j].start + 0.8
        else:
            continue
        if abs(want - sh.natural) > 0.05:
            bad.append(f"{sh.shot_id} 表填 {sh.natural} / 实算 {want:.2f}")
    rep.add("FAIL" if bad else "ok", "1d 自然时长与 SRT 一致（±0.05）", "；".join(bad))

    rep.add("FAIL" if gaps else "ok", "3  镜头区间无缝覆盖时间轴", "；".join(gaps))

    bad, skipped = [], []
    for s in shots:
        if s.kind != "展示":
            continue
        nums = [int(x) for x in re.findall(r"\d+", s.cue_range)]
        if not nums:
            continue
        route = s.cells.get("文字路线", "")
        if "跨句" in s.mark:
            # 豁免一：越界半句由相邻镜的画面承接，机器分不出边界。
            skipped.append(f"{s.shot_id}(跨句)")
            continue
        if "post only" in route:
            # 豁免二：文字整体走后期叠加，参考图里本就不出现，改核对后期文字清单。
            skipped.append(f"{s.shot_id}(post only)")
            continue
        narration = normalize("".join(c.clean_text for c in cues[nums[0] - 1 : nums[-1]]))
        onscreen = normalize(s.keywords)
        if narration and not is_subsequence(narration, onscreen):
            bad.append(s.shot_id)
    note = "旁白不是上屏文字的子序列：" + "、".join(bad) if bad else ""
    if skipped:
        note += ("；" if note else "") + "已豁免，需人工核对：" + "、".join(skipped)
    rep.add("FAIL" if bad else ("warn" if skipped else "ok"), "7b 展示型上屏文字完整覆盖旁白", note)


# ---------------------------------------------------------------- main


def main(argv: list[str]) -> int:
    if not 2 <= len(argv) <= 4:
        print(__doc__)
        return 2

    sb_path = Path(argv[1])
    md, enc = read_text(sb_path)
    print(f"分镜表：{sb_path}  （编码 {enc}）")

    cues: list[Cue] = []
    if len(argv) >= 3:
        srt_path = Path(argv[2])
        srt_text, srt_enc = read_text(srt_path)
        cues = parse_srt(srt_text)
        print(f"字幕：  {srt_path}  （编码 {srt_enc}，{len(cues)} 条）")

    density = argv[3] if len(argv) == 4 else "standard"

    found = find_table(md)
    if not found:
        print("\n找不到分镜表。表头需含：" + "、".join(HEADER_KEYS))
        print("格式要求见 storyboard-algorithm.md 第 10 节「机器可读约束」。")
        return 2

    header, rows = found
    shots, problems = parse_shots(header, rows)
    print(f"解析到 {len(shots)} 镜，文字密度按 {density} 计。\n")

    rep = Report()
    for p in problems:
        rep.add("FAIL", "0  表格可解析", p)
    if not problems:
        rep.add("ok", "0  表格可解析", "")
    check(shots, cues, density, rep)
    return rep.emit()


if __name__ == "__main__":
    sys.exit(main(sys.argv))
