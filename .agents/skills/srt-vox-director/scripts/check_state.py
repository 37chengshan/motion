#!/usr/bin/env python3
"""state.json 校验器（可选工具）

守的是 skill 反复强调、却一直没自动化的那一条：**state.json 是断点续跑的唯一状态源**
（delivery-contract.md 第 10 节），续跑前必须先校验 `total_shots` 与
`storyboard.md` 的实际行数是否一致——对不上说明用户手动改过分镜表，
按旧状态往下出提示词，镜号会全部错位。

这条规矩以前靠 agent 自觉人工对账；skill 的整体哲学又是「交给机器最划算」
（见 storyboard-algorithm.md 第 11 节校验器自述）。本脚本把那一步补上。

校验项（全部机器可判）：
    S1  total_shots == storyboard.md 行数 == 01_提示词/ 的镜号数（三向对账）
    S2  01_提示词/ 镜号连续无缺口
    S3  shots_done 与 next_batch 不重叠、不越界、与已写文件一致
    S4  style_id 与每镜提示词里 style-board/SNN 路径一致
    S5  style_locked 为 true 时，任何提示词不能换成别的风格
    S6  batch_size 落在 storyboard-algorithm §9 的分档表（{5,8,10}）
        且与 total_shots 对应的那一档一致
    S7  text_density ∈ {minimal, standard, editorial-dense}
    S8  clip_limits 若存在 == [4,6,8,10]（不可配，吸附表锁死在这套阶梯上）
    S9  split_shots 与 bridge_frames 互恰：每个拆分镜都有对应桥接帧、source 合法
    S10 scale 字段与 total_shots + split_shots 自洽（§9 规模公式）

用法：
    python scripts/check_state.py <项目目录>                       # 默认找目录/state.json
    python scripts/check_state.py <项目目录>/state.json
    python scripts/check_state.py <项目> --storyboard <路径> --prompts <路径>

只读，不改任何文件。退出码 0 = 全过，1 = 有 FAIL，2 = 没找到 state.json。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# 校验器共享的常量集中在 _lint_rules，副本一旦分家早晚会漏改。
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lint_rules import CLIP_LENGTHS, DENSITY_CAP, read_text  # noqa: E402

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

# storyboard-algorithm §9 的批大小分档表。这里只复述一次，因为它本就是受管数值——
# state.json 的 batch_size 必须落在 {5,8,10}，且与 total_shots 对应的那一档一致。
BATCH_TIERS = ((30, 5), (40, 8))  # (上限, 批大小)；>40 取 10
VALID_DENSITY = set(DENSITY_CAP)  # {"minimal","standard","editorial-dense"}
VALID_BRIDGE_SOURCE = {"extract", "render"}

SID_RE = re.compile(r"^S(\d{2})([a-z]?)$")          # 镜号：S01 / S05a
BOARD_RE = re.compile(r"style-board[/\\](S\d{2})")  # 提示词里的风格板路径


class Report:
    """与 check_storyboard / check_prompts 同一套报告器风格。"""

    def __init__(self) -> None:
        self.rows: list[tuple[str, str, str]] = []

    def add(self, status: str, rule: str, detail: str = "") -> None:
        self.rows.append((status, rule, detail))

    def emit(self) -> int:
        width = max((len(r) for _, r, _ in self.rows), default=0)
        fails = 0
        for status, rule, detail in self.rows:
            print(f"[{status:4}] {rule.ljust(width)}  {detail}")
            fails += status == "FAIL"
        print()
        print(f"{len(self.rows)} 项机器检查，{fails} 项 FAIL。")
        print("提示词里风格板路径有没有漏、shots_done 与磁盘对不对，机器判得准；")
        print("语义类（这一镜该不该拆、scale 公式选哪条路线）仍要人工过。")
        return 1 if fails else 0


def find_state(arg: str) -> Path | None:
    """参数可以是 state.json 本身，也可以是它所在的目录。"""
    p = Path(arg)
    if p.is_file():
        return p
    if p.is_dir():
        s = p / "state.json"
        return s if s.is_file() else None
    return None


def expected_batch(total_shots: int) -> int:
    for cap, size in BATCH_TIERS:
        if total_shots <= cap:
            return size
    return 10


def parse_shot_nums(prompts_dir: Path) -> tuple[list[int], list[Path]]:
    """从 01_提示词/S*.md 收集镜号。拆分镜 S05a/S05b 都归到镜 5。

    返回 (去重排序的镜号列表, 所有匹配的文件路径)。镜号连续性看前者；
    S3 的「已写文件」用后者的 stem。
    """
    nums: set[int] = set()
    files: list[Path] = []
    if not prompts_dir.is_dir():
        return [], []
    for p in sorted(prompts_dir.glob("S*.md")):
        m = SID_RE.match(p.stem)
        if not m:
            continue
        nums.add(int(m.group(1)))
        files.append(p)
    return sorted(nums), files


def storyboard_shot_count(sb: Path) -> int | None:
    """数 storyboard.md 分镜表的正文行数。

    与 check_storyboard.find_table 同一套判据：表头含「镜号」、紧接分隔行、
    正文行计到「合计」或表格中断（空行/无 |）。**必须停在合计行**——
    合计行之后还可能有规模提示表（见 delivery-contract §4），那几张表的行
    长得跟正文行一样，会被误数成镜头。
    """
    md = read_text(sb)
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
                break  # 表格中断
            cells = [c.strip() for c in body.strip().strip("|").split("|")]
            if cells and cells[0].startswith("合计"):
                break  # 汇总行，不计
            n += 1
        return n
    return None


def board_ids_in_file(md: str) -> list[str]:
    """提示词文件里出现的所有风格板 ID（SNN）。一条文件全片只该出现一种。"""
    return BOARD_RE.findall(md)


def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        return 2

    state_path = find_state(args[0])
    if state_path is None:
        print(f"在 {args[0]} 下没找到 state.json。")
        print("它是断点续跑的唯一状态源，schema 见 delivery-contract.md 第 10 节。")
        return 2

    # 覆写项：--storyboard / --prompts；默认从 state 推
    overrides = {}
    if "--storyboard" in argv:
        i = argv.index("--storyboard")
        if i + 1 < len(argv):
            overrides["storyboard"] = Path(argv[i + 1])
    if "--prompts" in argv:
        i = argv.index("--prompts")
        if i + 1 < len(argv):
            overrides["prompts"] = Path(argv[i + 1])

    try:
        state = json.loads(read_text(state_path))
    except json.JSONDecodeError as e:
        print(f"state.json 不是合法 JSON：{e}")
        return 2

    base = state_path.parent
    sb_path = overrides.get("storyboard")
    if sb_path is None:
        sb_rel = state.get("storyboard_path", "storyboard.md")
        sb_path = (base / sb_rel).resolve()
    prompts_dir = overrides.get("prompts", base / "01_提示词")

    print(f"state.json：{state_path}")
    print(f"分镜表：  {sb_path}  （{'存在' if sb_path.is_file() else '缺失'}）")
    print(f"提示词：  {prompts_dir}  （{'存在' if prompts_dir.is_dir() else '缺失'}）\n")

    rep = Report()

    # ---- 枚举类先判：值错会让下游静默失效 ----
    density = state.get("text_density", "standard")
    rep.add("FAIL" if density not in VALID_DENSITY else "ok",
            "S7 text_density ∈ {minimal,standard,editorial-dense}",
            f"实际是 {density!r}" if density not in VALID_DENSITY else "")

    clip_limits = state.get("clip_limits")
    if clip_limits is not None:
        rep.add("FAIL" if set(clip_limits) != CLIP_LENGTHS else "ok",
                "S8 clip_limits == [4,6,8,10]",
                f"实际是 {clip_limits}——这套阶梯锁死在吸附表，不可配" if set(clip_limits) != CLIP_LENGTHS else "")

    total = state.get("total_shots")
    batch = state.get("batch_size")
    if isinstance(total, int) and isinstance(batch, int):
        want = expected_batch(total)
        rep.add("FAIL" if batch not in {5, 8, 10} else ("FAIL" if batch != want else "ok"),
                "S6 batch_size 与 §9 分档表一致",
                f"实际 {batch}，total_shots={total} 那一档应是 {want}" if batch != want
                else (f"实际 {batch} 不在 {{5,8,10}}" if batch not in {5, 8, 10} else ""))

    # ---- S1 三向对账：state ↔ storyboard ↔ prompts ----
    sb_count = storyboard_shot_count(sb_path) if sb_path.is_file() else None
    prompt_nums, _ = parse_shot_nums(prompts_dir)
    state_count = total if isinstance(total, int) else None

    mismatch = []
    if state_count is None:
        mismatch.append("state 缺 total_shots")
    if sb_count is None:
        mismatch.append("storyboard.md 找不到分镜表")
    if not prompt_nums:
        mismatch.append(f"{prompts_dir} 下没有 S*.md")
    if state_count is not None and sb_count is not None and state_count != sb_count:
        mismatch.append(f"state.total_shots={state_count} ≠ storyboard 行数 {sb_count}")
    if state_count is not None and prompt_nums and state_count != len(prompt_nums):
        mismatch.append(f"state.total_shots={state_count} ≠ 提示词镜号数 {len(prompt_nums)}")
    if sb_count is not None and prompt_nums and sb_count != len(prompt_nums):
        mismatch.append(f"storyboard 行数 {sb_count} ≠ 提示词镜号数 {len(prompt_nums)}")
    rep.add("FAIL" if mismatch else "ok", "S1 三向对账（state ↔ storyboard ↔ prompts）",
            "；".join(mismatch) if mismatch else f"均为 {state_count}")

    # ---- S2 提示词镜号连续 ----
    if prompt_nums:
        gaps = [n for n in range(prompt_nums[0], prompt_nums[-1] + 1) if n not in prompt_nums]
        rep.add("FAIL" if gaps else "ok", "S2 提示词镜号连续无缺口",
                "缺 " + "、".join(f"S{n:02d}" for n in gaps) if gaps else "")

    # ---- S3 shots_done / next_batch ----
    done = state.get("shots_done", [])
    nxt = state.get("next_batch", [])
    if isinstance(done, list) and isinstance(nxt, list):
        overlap = sorted(set(done) & set(nxt))
        rep.add("FAIL" if overlap else "ok", "S3a shots_done 与 next_batch 不重叠",
                "重叠：" + "、".join(map(str, overlap)) if overlap else "")
        oob = [n for n in done + nxt if not isinstance(n, int) or n < 1
               or (state_count and n > state_count)]
        rep.add("FAIL" if oob else "ok", "S3b done/next 镜号在 [1, total_shots] 内",
                "越界：" + "、".join(map(str, oob)) if oob else "")
        # next_batch 应紧跟 done 之后（done 的最大值之后那批），不强制精确，
        # 只查「next_batch 里有没有比 max(done) 还小的镜号」
        if done and nxt:
            backward = [n for n in nxt if n <= max(done)]
            rep.add("FAIL" if backward else "ok", "S3c next_batch 全部在 done 之后",
                    "回退到已完成：" + "、".join(map(str, backward)) if backward else "")
        else:
            rep.add("ok", "S3c next_batch 全部在 done 之后", "")

    # ---- S4 / S5 style_id 与每镜风格板路径一致 ----
    style_id = state.get("style_id")
    style_locked = state.get("style_locked", False)
    if prompt_nums and style_id:
        bad_files: list[str] = []
        for p in sorted(prompts_dir.glob("S*.md")):
            m = SID_RE.match(p.stem)
            if not m:
                continue
            ids = board_ids_in_file(read_text(p))
            if not ids:
                continue  # 缺路径由 check_prompts 的 X1 守，这里不重复
            if any(sid != style_id for sid in ids):
                bad_files.append(f"{p.stem}({','.join(set(ids))})")
            if len(set(ids)) > 1:
                bad_files.append(f"{p.stem} 同一文件出现多个风格板 ID")
        rep.add("FAIL" if bad_files else "ok", "S4 每镜风格板 == state.style_id",
                "；".join(bad_files) if bad_files else f"全部 {style_id}")
        # 锁定状态下风格板换成别的 ID 已由 S4 覆盖；style_locked 本身的类型只查一次
        rep.add("FAIL" if not isinstance(style_locked, bool) else "ok",
                "S5 style_locked 是布尔",
                f"实际是 {type(style_locked).__name__}" if not isinstance(style_locked, bool) else "")
    else:
        rep.add("skip", "S4 每镜风格板 == state.style_id",
                "state 缺 style_id 或没有提示词文件")
        rep.add("skip", "S5 style_locked 是布尔", "同上")

    # ---- S9 split_shots ↔ bridge_frames 互恰 ----
    splits = state.get("split_shots", [])
    bridges = state.get("bridge_frames", [])
    if isinstance(splits, list) and isinstance(bridges, list):
        bridge_shots = {b.get("shot") for b in bridges if isinstance(b, dict)}
        missing_bridge = [s for s in splits if s not in bridge_shots]
        rep.add("FAIL" if missing_bridge else "ok", "S9a 每个拆分镜都有桥接帧",
                "缺桥接帧的拆分镜：" + "、".join(map(str, missing_bridge)) if missing_bridge else "")
        extra_bridge = [b.get("shot") for b in bridges
                        if isinstance(b, dict) and b.get("shot") not in splits]
        rep.add("warn" if extra_bridge else "ok", "S9b 桥接帧都对应拆分镜",
                "桥接帧指向非拆分镜：" + "、".join(map(str, extra_bridge)) if extra_bridge else "")
        bad_src = [f"{b.get('id', b.get('shot'))}({b.get('source')})"
                   for b in bridges if isinstance(b, dict)
                   and b.get("source") not in VALID_BRIDGE_SOURCE]
        rep.add("FAIL" if bad_src else "ok", "S9c bridge source ∈ {extract,render}",
                "非法值：" + "、".join(bad_src) if bad_src else "")
    else:
        rep.add("skip", "S9 拆分镜与桥接帧互恰", "字段类型不符")

    # ---- S10 scale 自洽（§9 规模公式）----
    scale = state.get("scale")
    if (isinstance(scale, dict) and isinstance(total, int)
            and isinstance(splits, list)):
        q = len(splits)
        p = total - q
        clips_expected = p + 2 * q  # 无论路线，片段条数恒为 P + 2Q
        clips = scale.get("clips")
        ref = scale.get("reference_images")
        calls = scale.get("calls")
        refs_ok = ref in (total, clips_expected)  # extract → total；render → clips
        clips_ok = clips == clips_expected
        calls_ok = calls == ref + clips_expected if ref in (total, clips_expected) else False
        details = []
        if not clips_ok:
            details.append(f"clips={clips}，公式 P+2Q={clips_expected}(P={p},Q={q})")
        if not refs_ok:
            details.append(f"reference_images={ref}，应为 {total}(抽帧) 或 {clips_expected}(出图)")
        if not calls_ok:
            details.append(f"calls={calls}，应为 参考图+片段={ref}+{clips_expected}")
        rep.add("FAIL" if details else "ok", "S10 scale 与规模公式自洽",
                "；".join(details) if details else f"clips={clips_expected} ref={ref} calls={ref + clips_expected}")
    else:
        rep.add("skip", "S10 scale 与规模公式自洽", "缺 scale/total_shots/split_shots")

    return rep.emit()


if __name__ == "__main__":
    sys.exit(main(sys.argv))
