#!/usr/bin/env python3
"""校验器回归测试（stdlib unittest）

用 subprocess 跑三个校验器，模拟 SKILL.md 路由表里的真实调用方式：
    python scripts/check_storyboard.py ...
    python scripts/check_prompts.py ...
    python scripts/check_state.py ...
    python scripts/check_docs.py

不 import 校验器——那条路脆弱（sys.path、模块名带连字符），
也不反映 agent 实际怎么调它们。

fixtures/good/ 是一个从 end-to-end.md 落地的完整 3 镜项目，三个校验器全过；
fixtures/bad/  故意埋 FAIL，每条规则一个触发点。两者合起来既当可执行文档
（agent 可以照 fixtures/good/ 的真实文件结构模仿），又防回归。

跑法：
    python -m unittest discover -s tests        # 从 skill 根目录
    python tests/test_checkers.py               # 直接跑
"""

from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
FIXTURES = ROOT / "tests" / "fixtures"
GOOD = FIXTURES / "good"
BAD = FIXTURES / "bad"

TEXT_KW = {"encoding": "utf-8", "errors": "replace"}


def run(script, *args):
    return subprocess.run(
        [sys.executable, str(SCRIPTS / script), *map(str, args)],
        capture_output=True,
        cwd=ROOT,
        **TEXT_KW,
    )


def fail_lines(out):
    # 三个校验器的标记格式不一样：check_storyboard / check_state 用 "[FAIL]"，
    # check_prompts 用 "FAIL"（无方括号）。两种都认。
    return [ln for ln in out.splitlines()
            if "[FAIL]" in ln or ln.startswith("FAIL ")]


class CheckStoryboardGood(unittest.TestCase):
    def test_passes_with_srt(self):
        r = run("check_storyboard.py", GOOD / "storyboard.md", GOOD / "校园招新.srt", "standard")
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertNotIn("[FAIL]", r.stdout)

    def test_passes_without_srt(self):
        r = run("check_storyboard.py", GOOD / "storyboard.md")
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertNotIn("[FAIL]", r.stdout)


class CheckStoryboardBad(unittest.TestCase):
    def setUp(self):
        self.r = run("check_storyboard.py", BAD / "storyboard.md")
        self.fails = fail_lines(self.r.stdout)

    def test_returns_fail_exit_code(self):
        self.assertNotEqual(self.r.returncode, 0, self.r.stdout)

    def test_catches_short_shot_without_mark(self):
        self.assertTrue(any("5e" in ln and "S03" in ln for ln in self.fails), self.r.stdout)

    def test_catches_illegal_visual_task(self):
        self.assertTrue(any("4b" in ln for ln in self.fails), self.r.stdout)

    def test_catches_delta_over_1_when_natural_ge_3(self):
        self.assertTrue(any("5b" in ln for ln in self.fails), self.r.stdout)

    def test_catches_non_nearest_clip_length(self):
        self.assertTrue(any("5d" in ln for ln in self.fails), self.r.stdout)


class CheckPromptsGood(unittest.TestCase):
    def test_passes(self):
        r = run("check_prompts.py", GOOD)
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertNotIn("[FAIL]", r.stdout)

    def test_state_cross_check_via_storyboard(self):
        r = run("check_prompts.py", GOOD, "--storyboard", GOOD / "storyboard.md")
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertNotIn("[FAIL]", r.stdout)


class CheckPromptsBad(unittest.TestCase):
    def setUp(self):
        self.r = run("check_prompts.py", BAD)
        self.fails = fail_lines(self.r.stdout)

    def test_returns_fail_exit_code(self):
        self.assertNotEqual(self.r.returncode, 0, self.r.stdout)

    def test_catches_missing_style_board_path(self):
        self.assertTrue(any("X1" in ln for ln in self.fails), self.r.stdout)

    def test_catches_lump_lock_block(self):
        self.assertTrue(any("V1" in ln for ln in self.fails), self.r.stdout)

    def test_catches_illegal_clip_length(self):
        self.assertTrue(any("V5" in ln for ln in self.fails), self.r.stdout)

    def test_catches_text_carrier_from_offscreen(self):
        self.assertTrue(any("V9" in ln or "R7" in ln for ln in self.fails), self.r.stdout)

    def test_catches_missing_three_layers(self):
        self.assertTrue(any("R3 三层齐全" in ln for ln in self.fails), self.r.stdout)


class CheckStateGood(unittest.TestCase):
    def test_passes(self):
        r = run("check_state.py", GOOD)
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertNotIn("[FAIL]", r.stdout)


class CheckStateBad(unittest.TestCase):
    def setUp(self):
        self.r = run("check_state.py", BAD)
        self.fails = fail_lines(self.r.stdout)

    def test_returns_fail_exit_code(self):
        self.assertNotEqual(self.r.returncode, 0, self.r.stdout)

    def test_catches_three_way_mismatch(self):
        self.assertTrue(any("S1 三向对账" in ln for ln in self.fails), self.r.stdout)

    def test_catches_bad_density(self):
        self.assertTrue(any("S7" in ln for ln in self.fails), self.r.stdout)

    def test_catches_bad_clip_limits(self):
        self.assertTrue(any("S8" in ln for ln in self.fails), self.r.stdout)

    def test_catches_bad_batch_size(self):
        self.assertTrue(any("S6" in ln for ln in self.fails), self.r.stdout)

    def test_catches_done_next_overlap(self):
        self.assertTrue(any("S3a" in ln for ln in self.fails), self.r.stdout)

    def test_catches_split_without_bridge(self):
        self.assertTrue(any("S9a" in ln for ln in self.fails), self.r.stdout)

    def test_catches_scale_inconsistent(self):
        self.assertTrue(any("S10" in ln for ln in self.fails), self.r.stdout)


class CheckDocsRemainsClean(unittest.TestCase):
    """check_docs.py 扫的是 skill 自己的文档。fixtures/ 是测试数据，
    check_docs 的 load() 已经跳过 tests/ 子目录；这条断言锁住「别让 fixture
    里的版式术语、断链、非法计数反向污染 check_docs」。"""

    def test_clean(self):
        r = run("check_docs.py")
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertNotIn("[FAIL]", r.stdout)


class SharedConstantsNoDrift(unittest.TestCase):
    """守 _lint_rules.py 与三个校验器之间的 import 关系——
    副本一旦分家，check_docs 扫不到（它只扫 .md）。这里直接断言 import 仍成立。"""

    def test_checkers_import_shared_constants(self):
        sys.path.insert(0, str(SCRIPTS))
        try:
            import _lint_rules  # noqa: F401
            from _lint_rules import BANNED, CLIP_LENGTHS, DENSITY_CAP, ENCODINGS, read_text  # noqa: F401
        finally:
            sys.path.pop(0)

    def test_banned_has_four_rules(self):
        sys.path.insert(0, str(SCRIPTS))
        try:
            from _lint_rules import BANNED
            self.assertEqual(len(BANNED), 4)
        finally:
            sys.path.pop(0)


class CheckSectionLinksGuard(unittest.TestCase):
    """守 check_section_links 自己——它是防章节重编号漂移的检查器，
    如果它自己被改坏（比如把 `not in` 写反成 `in`），CheckDocsRemainsClean
    抓不到（干净场景本就不触发漂移）。这里直接构造漂移场景断言 FAIL。
    参照 SharedConstantsNoDrift 的 import 模式，绕开 load() 跳过 tests/ 的限制。"""

    @staticmethod
    def _make_by_name(sections_by_file):
        """构造一个最小 by_name dict：{basename: Doc(numbered_sections=...)}。
        check_section_links 只读 target.numbered_sections，其余字段不需要。"""
        sys.path.insert(0, str(SCRIPTS))
        try:
            from check_docs import Doc
        finally:
            sys.path.pop(0)
        return {
            basename: Doc(path=f"references/{basename}", numbered_sections=secs)
            for basename, secs in sections_by_file.items()
        }

    @staticmethod
    def _run(sections_by_file):
        sys.path.insert(0, str(SCRIPTS))
        try:
            from check_docs import check_section_links
        finally:
            sys.path.pop(0)
        docs = []  # check_section_links 只用 by_name，docs 形参不读
        return check_section_links(docs, CheckSectionLinksGuard._make_by_name(sections_by_file))

    def test_clean_when_titles_match(self):
        # 正常场景：所有注册项的标题都含关键词 → 0 FAIL（回归镜像，防把 not in 写反）
        sections = {
            "prompt-motion.md": {6: "参考图角色、组装方向与桥接帧", 3: "收束与填充动作库"},
            "prompt-templates.md": {5: "图生视频提示词模板", 4: "参考图提示词模板"},
            "storyboard-algorithm.md": {6: "差值处理"},
        }
        fails = [f for f in self._run(sections) if f.level == "FAIL"]
        self.assertEqual(fails, [], "干净场景不应有 FAIL——若失败说明条件逻辑被写反了")

    def test_catches_renumber_drift(self):
        # 重编号漂移：§6 标题不再含「组装方向」（例如被拆成新 §6 + §7，旧内容滑到 §7）
        sections = {
            "prompt-motion.md": {6: "桥接帧与抽帧路线", 3: "收束与填充动作库"},  # §6 丢了「组装方向」
            "prompt-templates.md": {5: "图生视频提示词模板", 4: "参考图提示词模板"},
            "storyboard-algorithm.md": {6: "差值处理"},
        }
        fails = [f for f in self._run(sections) if f.level == "FAIL"]
        self.assertTrue(any("组装方向" in f.detail and "不再含" in f.detail for f in fails),
                        f"应报标题漂移 FAIL，实际：{[f.detail for f in fails]}")

    def test_catches_deleted_section(self):
        # 章节被删：prompt-templates §5 不存在了
        sections = {
            "prompt-motion.md": {6: "参考图角色、组装方向与桥接帧", 3: "收束与填充动作库"},
            "prompt-templates.md": {4: "参考图提示词模板"},  # §5 缺失
            "storyboard-algorithm.md": {6: "差值处理"},
        }
        fails = [f for f in self._run(sections) if f.level == "FAIL"]
        self.assertTrue(any("第 5 节存在" in f.detail for f in fails),
                        f"应报章节被删 FAIL，实际：{[f.detail for f in fails]}")

    def test_registry_targets_real_sections(self):
        # 覆盖守卫：注册表 5 条的 target 都应是真实文件，section 号在真实文档范围内
        sys.path.insert(0, str(SCRIPTS))
        try:
            from check_docs import SECTION_LINKS
        finally:
            sys.path.pop(0)
        self.assertGreaterEqual(len(SECTION_LINKS), 5, "注册表至少 5 条（top-5 高爆炸半径）")
        # 每条的 target_file 都应是 references/ 下的真实 .md
        for sl in SECTION_LINKS:
            self.assertTrue((ROOT / sl.target_file).is_file(),
                            f"SECTION_LINKS 指向不存在的文件：{sl.target_file}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
