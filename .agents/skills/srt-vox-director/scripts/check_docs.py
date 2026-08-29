#!/usr/bin/env python3
"""文档一致性校验器（维护用，不参与出片流程）

守的是这个 skill 反复栽跟头的那一类错：**改了正典，下游那些顺手复述过一遍的地方没跟。**
七类检查：

    link     跨文件链接指向不存在的文件
    section  「xxx.md 第 N 节」指向的章节号在目标文件里不存在
    section  高爆炸半径章节的标题漂移（下面 SECTION_LINKS 注册表说了算）——防重编号
    toc      文件顶部的目录与实际 `## N.` 标题对不上
    managed  受管数值出现在它的正典之外（下面 MANAGED 注册表说了算）
    canon    自称「唯一正典」的章节没进注册表，或注册表指向已搬走的章节
    count    「共 N 段」「N 条」这类计数出现在引用位
    wording  版式术语混进了可粘贴提示词（下面 FENCE_BANNED 说了算）

扫描规则：围栏代码块里的可粘贴提示词正文**跳过**（那是给模型抄的，必须带数字），
但块内 `【...】` 的中文占位说明**照扫**——那是写给 agent 的指令，
D7 那次「四选一」漏改就藏在这种地方。
唯一的反向例外是 wording：它**只**扫围栏内，因为它管的正是模型读到的那些字。

用法：
    python scripts/check_docs.py            # 在 skill 根目录跑
    python scripts/check_docs.py --list     # 只列出注册表，不扫描

退出码 0 = 干净，1 = 有 FAIL。
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

# 校验器共享的常量集中在 _lint_rules。本文件的 load() 还做章节追踪，
# 签名与 _lint_rules.read_text 不同，仍自带。
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lint_rules import BANNED as _SHARED_BANNED  # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


# ---------------------------------------------------------------- 注册表


@dataclass(frozen=True)
class Managed:
    name: str
    pattern: str
    canon_file: str
    canon_sections: tuple[str, ...] = ()   # 空 = 整个文件都算正典
    allow: tuple[tuple[str, str], ...] = ()  # (文件, 理由)，理由会打印出来
    why: str = ""


# 围栏内禁用的版式术语。与 check_prompts.py 的 BANNED 同源——
# 两份各写各的就会漂移，所以统一从 _lint_rules 取，这里只留个本文件惯用的别名。
# 模型只会「画什么」，没有「不画」这个动作：收到「留出 8% 作为字幕边距」这种排版概念，
# 它会把概念物化成一条可见的白色实体色块。改法一律是正面说这块区域画什么
# ——「这条带子里只有背景本身继续延伸」——再点名禁止那些物化产物。
# 注意「新增字幕」是合法的：那是视频提示词避免清单里给模型的指令，不是版式术语。
FENCE_BANNED: list[tuple[re.Pattern[str], str]] = _SHARED_BANNED

# 围栏内但**不是**给模型看的地方。视觉圣经是写给 agent 的全片规范，
# 它该用「字幕安全区」这种操作者语言说清意图；agent 再把它翻译成模型能执行的句子。
FENCE_ALLOW: list[tuple[str, str, str]] = [
    ("references/prompt-templates.md", "2. 视觉圣经模板", "视觉圣经是规范不是提示词，读者是 agent"),
    ("examples/end-to-end.md", "三 · 视觉圣经（节选）", "同上，这是填好的示例"),
]


MANAGED: list[Managed] = [
    Managed(
        "尾部档位名",
        r"(?:余量|补差)\s*[≤≥<>]\s*\d|\d\s*[-–—~至]\s*\d\s*秒(?:的)?(?:余量|补差)",
        "references/storyboard-algorithm.md", ("5. 吸附表", "6. 差值处理"),
        allow=(
            ("examples/end-to-end.md", "算例必须点名落在哪一档，否则读者无法照着复算"),
            ("examples/storyboard-examples.md", "同上"),
        ),
        why="档位名只许出现在吸附表与尾部契约表，复述到哪里哪里就会在下次改档时漏掉",
    ),
    Managed(
        "末段静止时长",
        r"末段(?:绝对)?静止[^。\n]{0,8}0\.\d|(?:定格|静止|稳定)\s*0\.\d\s*[s秒]",
        "references/storyboard-algorithm.md", ("6. 差值处理",),
        allow=(("examples/end-to-end.md", "算例要报出具体秒数，读者要能对着复算"),),
        why="0.2 / 0.6 这两个数只在尾部契约表里定义",
    ),
    Managed(
        "展示型入场公式",
        r"min\s*\(\s*生成时长\s*÷\s*3",
        "references/storyboard-algorithm.md", ("2. 镜头两型",),
        allow=(
            ("references/prompt-templates.md", "第 5 节展示型模板正典，公式与档位对照表在此"),
            ("references/delivery-contract.md", "第 8 节用户自检表要用户自己核对"),
        ),
    ),
    Managed(
        "文字密度上限",
        r"minimal\s*2\s*/|standard\s*5\s*/|editorial-dense\s*8",
        "references/prompt-keywords.md", ("三档密度",),
        allow=(
            ("references/storyboard-algorithm.md", "校验器 9a 要能独立跑，保留一份"),
            ("references/delivery-contract.md", "state.json 字段说明"),
        ),
    ),
    Managed(
        "规模公式",
        r"P\s*\+\s*2?\s*Q",
        "references/storyboard-algorithm.md", ("9. 规模提示",),
        allow=(("SKILL.md", "分镜完成后必须给规模提示，路由层要能判断"),),
    ),
    Managed(
        "批大小分档",
        r"31\s*[-–—]\s*40",
        "references/storyboard-algorithm.md", ("9. 规模提示",),
    ),
    Managed(
        "差值率阈值",
        r"差值率[^。\n]{0,12}(?:10|20)\s*%|(?:10|20)\s*%[^。\n]{0,6}差值率",
        "references/storyboard-algorithm.md", ("6. 差值处理",),
        allow=(
            ("SKILL.md", "20% 是判定阈值，D2 规矩允许留在路由层"),
            ("examples/end-to-end.md", "算例要报出具体数字"),
        ),
    ),
    Managed(
        "吸附分界点",
        r"分界点\s*落?在?\s*5",
        "references/storyboard-algorithm.md", ("5. 吸附表",),
        allow=(
            ("SKILL.md", "判定阈值，D2 规矩允许"),
            ("README.md", "介绍文档，面向人不面向流程"),
        ),
    ),
    Managed(
        "字块上限",
        r"14\s*字块",
        "references/prompt-keywords.md",
        ("计字口径：印刷字块", "四种文字角色", "三档密度", "渲染路线决策"),
        allow=(
            ("references/storyboard-algorithm.md", "第 2 节与校验器 9b 要能独立判定"),
            ("README.md", "介绍文档"),
        ),
    ),
    Managed(
        "载体四类",
        r"嵌入\s*/\s*粘贴\s*/\s*立牌\s*/\s*悬挂|嵌入\s*、\s*粘贴\s*、\s*立牌\s*、\s*悬挂",
        "references/prompt-keywords.md", ("关键词台账", "验收清单"),
        allow=(
            ("references/prompt-templates.md", "第 3 节台账模板必须列出可填值"),
            ("references/style-library.md", "载体标注是这四类的数据源"),
            ("references/style-gallery.md", "样图说明记录四类跑满"),
        ),
    ),
    Managed(
        "展示型卡数上限",
        r"[≤<]\s*8\s*张卡|8\s*张卡|八张卡",
        "references/prompt-keywords.md", ("三档密度", "渲染路线决策", "验收清单"),
        allow=(("references/storyboard-algorithm.md", "第 2 节与校验器 9b 要能独立判定"),),
        why="与 editorial-dense 的 8 同值但理由不同，两处不可合并",
    ),
    Managed(
        "收束动作名",
        r"小回弹|卡扣落位|标签压平|部件沉降|纸张回弹",
        "references/prompt-motion.md", ("3. 收束与填充动作库（同一批六项，两种用途）",),
        why="六项清单一旦有副本，早晚会少一项",
    ),
    Managed(
        "无字装饰动作名",
        r"纸片翘落|回形针压角|纸带入底|背景层独移|圆片滚出",
        "references/prompt-motion.md", ("3. 收束与填充动作库（同一批六项，两种用途）",),
        why="展示型专用的另一批动作，和收束动作同住第 3 节；"
            "它曾被误放在 prompt-templates 第 5 节，动作库一律归 prompt-motion",
    ),
    Managed(
        "读字保护区比例",
        r"读字保护区[^。\n]{0,16}15\s*%|短边的?\s*15\s*%",
        "references/prompt-templates.md", ("5. 图生视频提示词模板",),
        why="15% 是执行参数，只在动感预算三档那一节定义；"
            "「字幕安全区 8%」被抄成两份就是前车之鉴",
    ),
    Managed(
        "动感预算档名",
        r"[ABC]\s*(?:静读|点缀|分卡揭示)",
        "references/prompt-templates.md", ("5. 图生视频提示词模板",),
        allow=(("examples/storyboard-examples.md", "算例必须点名落在哪一档，否则读者无法照着复算"),),
        why="只扫完整档名，不扫「B / C 档」这种路由式引用——后者是允许的指路",
    ),
    Managed(
        "装饰物件公式",
        r"装饰(?:物件)?数?\s*=|装饰上限\s*[−\-]",
        "references/prompt-templates.md", ("4. 参考图提示词模板",),
        allow=(("examples/end-to-end.md", "算例要演示怎么减，读者要能对着复算"),),
        why="公式一旦被复述，改算法时复述处会留在旧版；风格块只写上限，路由层只说「算出来的」",
    ),
    Managed(
        "厚度线索落影值",
        r"10\s*[-–—~]\s*20\s*(?:像素|px)",
        "references/style-library.md",
        allow=(("examples/end-to-end.md", "视觉圣经与参考图提示词是可粘贴成品，必须带具体数值"),),
        why="厚度线索是风格属性，每条风格各写各的，只许留在风格块里；"
            "通用文件只说「查风格块」，一旦复述就会在改风格时漏改",
    ),
    Managed(
        "反组定住时长",
        r"0\.3\s*[-–—~]\s*0\.5",
        "references/prompt-motion.md", ("6. 参考图角色、组装方向与桥接帧",),
        why="反向组装可粘贴片段里的执行参数，只在组装方向那一小节定义",
    ),
]


# 高爆炸半径的「第 N 节」引用：这些章节被全片反复引用，一旦重编号（例如把 §6 拆成
# §6+§7），所有「第 6 节」会静默指向错的那半，而 check_sections 只查「节数存在」查不出。
# 这里登记「该节标题必须包含的关键词」，标题一漂移就 FAIL。模仿 MANAGED 的注册表模式：
# 从最高频的几条开始，随漂移事件增长。关键词选该节的核心名词（如「组装方向」而非全标题）。
@dataclass(frozen=True)
class SectionLink:
    target_file: str
    section: int
    title_must_contain: str
    why: str = ""


SECTION_LINKS: list[SectionLink] = [
    SectionLink("references/prompt-motion.md", 6, "组装方向",
                "全片被引用最多的章节（参考图角色+组装方向+桥接帧），拆动它影响最大"),
    SectionLink("references/prompt-templates.md", 5, "视频提示词",
                "图生视频模板正典，storyboard-algorithm 与 prompt-motion 都指向它"),
    SectionLink("references/storyboard-algorithm.md", 6, "差值",
                "尾部契约表所在，数值最密集的一节，重编号会让所有差值引用指错"),
    SectionLink("references/prompt-templates.md", 4, "参考图提示词",
                "参考图模板正典，被 prompt-motion §6 反向引用"),
    SectionLink("references/prompt-motion.md", 3, "收束",
                "收束/微动动作库，MANAGED 已守动作名，这里补守章节标题"),
]

# 自称「唯一正典」却没进注册表 = 没人守；写在这里的必须给理由
CANON_EXEMPT = {
    ("references/prompt-motion.md", "6. 参考图角色、组装方向与桥接帧"):
        "motion_dir 是枚举不是数值，且按设计要出现在项目简报、分镜表标记、"
        "模板分支多处，靠 D2 的判定阈值规矩管，正则扫描只会制造噪声。"
        "该节里唯一的数值（反组定住时长）已单独进注册表，不靠这条豁免",
    ("references/delivery-contract.md", "10. 分批状态"):
        "state.json 是 JSON schema，字段增删由续跑校验（total_shots 对账）兜底，不适合正则",
}

# 计数：只允许出现在拥有该事物的文件里
COUNT_PATTERN = (
    r"共\s*\d+\s*[段列条项张种个]|\d+\s*个字段|\d+\s*条(?:：|检查|规则)"
    r"|[一二三四五六七八九十\d]+\s*[项档](?:检查|全表|清单)"
)
COUNT_ALLOW = {
    "references/delivery-contract.md": "输出段落结构的正典，可写「共 10 段」",
    "references/style-gallery.md": "样图索引的正典，可写「共 21 张」",
    "references/prompt-keywords.md": "台账字段的正典，可写字段数",
    "references/prompt-motion.md": "动作库的正典，可写项数",
    "references/prompt-templates.md": "模板的正典，可写硬性约束条数",
    "references/style-library.md": "风格库的正典，可写风格数",
    "README.md": "介绍文档，面向人不面向流程",
}

CANON_DECL = re.compile(r"唯一正典|唯一状态源")
CANON_SELF = re.compile(r"本节|本表|这是|这六项")
SECTION_REF = re.compile(r"([A-Za-z0-9\-]+\.md)[^\n]{0,24}?第\s*(\d+)\s*节")
MD_LINK = re.compile(r"\]\(([^)#\s]+\.md)(?:#[^)]*)?\)")
H2_NUM = re.compile(r"^##\s+(\d+)\.\s*(.+?)\s*$")
H2_ANY = re.compile(r"^##\s+(.+?)\s*$")
TOC_ITEM = re.compile(r"^(\d+)\.\s+(.+?)\s*$")


# ---------------------------------------------------------------- 扫描


@dataclass
class Line:
    path: str
    no: int
    text: str
    section: str
    in_fence: bool


@dataclass
class Doc:
    path: str
    lines: list[Line] = field(default_factory=list)
    numbered_sections: dict[int, str] = field(default_factory=dict)
    all_sections: list[str] = field(default_factory=list)
    toc: list[tuple[int, str]] = field(default_factory=list)


def load(root: Path) -> list[Doc]:
    docs = []
    for p in sorted(root.rglob("*.md")):
        rel_parts = p.relative_to(root).parts
        # tests/fixtures/ 下的 .md 是校验器的测试数据，不是 skill 文档——
        # bad fixture 故意带断链、版式术语、非法计数，扫到它们会把 check_docs 自己搞脏。
        if "tests" in rel_parts:
            continue
        rel = p.relative_to(root).as_posix()
        doc = Doc(rel)
        section, in_fence, in_toc = "", False, False
        for i, raw in enumerate(p.read_text(encoding="utf-8").split("\n"), start=1):
            if raw.lstrip().startswith("```"):
                in_fence = not in_fence
                continue
            if not in_fence:
                m2 = H2_ANY.match(raw)
                if m2:
                    section = m2.group(1)
                    in_toc = section == "目录"
                    mn = H2_NUM.match(raw)
                    if mn:
                        doc.numbered_sections[int(mn.group(1))] = mn.group(2)
                    doc.all_sections.append(section)
                elif in_toc:
                    mt = TOC_ITEM.match(raw.strip())
                    if mt:
                        doc.toc.append((int(mt.group(1)), mt.group(2)))
            doc.lines.append(Line(rel, i, raw, section, in_fence))
        docs.append(doc)
    return docs


def scannable(line: Line) -> bool:
    """围栏内只扫 【】 占位说明，围栏外全扫。"""
    return (not line.in_fence) or ("【" in line.text)


# ---------------------------------------------------------------- 检查


@dataclass
class Finding:
    level: str
    kind: str
    where: str
    detail: str


def check_links(docs: list[Doc], root: Path) -> list[Finding]:
    out = []
    for d in docs:
        base = (root / d.path).parent
        for ln in d.lines:
            for m in MD_LINK.finditer(ln.text):
                if not (base / m.group(1)).resolve().exists():
                    out.append(Finding("FAIL", "link", f"{d.path}:{ln.no}", f"指向不存在的 {m.group(1)}"))
    return out


def check_sections(docs: list[Doc], by_name: dict[str, Doc]) -> list[Finding]:
    out = []
    for d in docs:
        for ln in d.lines:
            for m in SECTION_REF.finditer(ln.text):
                target, num = by_name.get(m.group(1)), int(m.group(2))
                if target is None or not target.numbered_sections:
                    continue
                if num not in target.numbered_sections:
                    have = ", ".join(map(str, sorted(target.numbered_sections)))
                    out.append(Finding("FAIL", "section", f"{d.path}:{ln.no}",
                                       f"{m.group(1)} 没有第 {num} 节（实际有 {have}）"))
    return out


def check_section_links(docs: list[Doc], by_name: dict[str, Doc]) -> list[Finding]:
    """守高爆炸半径章节的「标题语义」——check_sections 只查节数存在，
    查不出重编号漂移（§6 拆成 §6+§7 后所有「第 6 节」静默指错半）。
    对注册表里每条，查目标节存在 AND 标题含关键词；不命中 FAIL。"""
    out = []
    for sl in SECTION_LINKS:
        target = by_name.get(sl.target_file.rsplit("/", 1)[-1])
        if target is None:
            out.append(Finding("FAIL", "section", sl.target_file,
                               f"SECTION_LINKS 指向 {sl.target_file}，文件不存在"))
            continue
        title = target.numbered_sections.get(sl.section)
        if title is None:
            have = ", ".join(map(str, sorted(target.numbered_sections)))
            n_links = sum(1 for s in SECTION_LINKS if s.target_file == sl.target_file)
            out.append(Finding("FAIL", "section", sl.target_file,
                               f"注册表说第 {sl.section} 节存在（实际有 {have}）——"
                               f"章节被删或重编号，该文件的 {n_links} 条注册项都要复查"))
        elif sl.title_must_contain not in title:
            out.append(Finding("FAIL", "section", sl.target_file,
                               f"第 {sl.section} 节标题是「{title}」，不再含「{sl.title_must_contain}」——"
                               f"疑似重编号漂移，引用该节的下游全部要复查"))
    return out


def check_toc(docs: list[Doc]) -> list[Finding]:
    out = []
    for d in docs:
        if not d.toc or not d.numbered_sections:
            continue
        for num, title in d.toc:
            actual = d.numbered_sections.get(num)
            if actual is None:
                out.append(Finding("FAIL", "toc", d.path, f"目录列了第 {num} 项，正文没有对应章节"))
            elif actual != title:
                out.append(Finding("FAIL", "toc", d.path,
                                   f"第 {num} 项目录写「{title}」，正文标题是「{actual}」"))
        for num, title in sorted(d.numbered_sections.items()):
            if num not in {n for n, _ in d.toc}:
                out.append(Finding("FAIL", "toc", d.path, f"正文有第 {num} 节「{title}」，目录漏了"))
    return out


def check_managed(docs: list[Doc]) -> list[Finding]:
    out = []
    for rule in MANAGED:
        rx = re.compile(rule.pattern)
        allowed = {f for f, _ in rule.allow}
        for d in docs:
            for ln in d.lines:
                if not scannable(ln) or not rx.search(ln.text):
                    continue
                if d.path == rule.canon_file:
                    if not rule.canon_sections or ln.section in rule.canon_sections:
                        continue
                    want = " / ".join(rule.canon_sections)
                    out.append(Finding("FAIL", "managed", f"{d.path}:{ln.no}",
                                       f"[{rule.name}] 出现在「{ln.section or '文件头'}」，"
                                       f"正典是本文件的「{want}」"))
                    continue
                if d.path in allowed:
                    continue
                loc = rule.canon_file + (f" 第「{' / '.join(rule.canon_sections)}」节" if rule.canon_sections else "")
                out.append(Finding("FAIL", "managed", f"{d.path}:{ln.no}",
                                   f"[{rule.name}] 正典在 {loc}"))
    return out


def check_canon(docs: list[Doc]) -> list[Finding]:
    """自称唯一正典的地方，必须有 MANAGED 条目在守；反过来注册表也不能指向已搬走的位置。"""
    declared: dict[tuple[str, str], int] = {}
    for d in docs:
        for ln in d.lines:
            if not scannable(ln) or not CANON_DECL.search(ln.text):
                continue
            if ".md" in ln.text or re.search(r"第\s*\d+\s*节", ln.text):
                continue                       # 指向别处的引用，不是自我声明
            if not CANON_SELF.search(ln.text):
                continue
            declared.setdefault((d.path, ln.section), ln.no)

    registered: set[tuple[str, str]] = set()
    for r in MANAGED:
        for s in (r.canon_sections or ("*",)):
            registered.add((r.canon_file, s))

    out = []
    for (path, section), no in sorted(declared.items()):
        if (path, section) in registered or (path, "*") in registered:
            continue
        if (path, section) in CANON_EXEMPT:
            continue
        out.append(Finding("FAIL", "canon", f"{path}:{no}",
                           f"「{section}」自称唯一正典，但 MANAGED 注册表里没有条目在守它——"
                           f"加一条规则，或写进 CANON_EXEMPT 并给理由"))

    known_sections = {(d.path, s) for d in docs for s in d.all_sections}
    for path, section in sorted(registered):
        if section != "*" and (path, section) not in known_sections:
            out.append(Finding("FAIL", "canon", path,
                               f"注册表指向「{section}」，该文件里没有这个章节——正典搬走了没同步"))
    for key, why in sorted(CANON_EXEMPT.items()):
        if key not in declared:
            out.append(Finding("warn", "canon", key[0],
                               f"CANON_EXEMPT 里的「{key[1]}」已经不再自称正典，豁免可以删了"))
    return out


def check_wording(docs: list[Doc]) -> list[Finding]:
    """只扫围栏内 —— 版式术语进了提示词，模型就会把它物化成一个可见物件。"""
    exempt = {(f, s) for f, s, _ in FENCE_ALLOW}
    out = []
    for d in docs:
        for ln in d.lines:
            if not ln.in_fence or (d.path, ln.section) in exempt:
                continue
            for rx, why in FENCE_BANNED:
                if m := rx.search(ln.text):
                    out.append(Finding("FAIL", "wording", f"{d.path}:{ln.no}",
                                       f"提示词里出现「{m.group()}」——{why}"))
    return out


def check_counts(docs: list[Doc]) -> list[Finding]:
    rx = re.compile(COUNT_PATTERN)
    out = []
    for d in docs:
        if d.path in COUNT_ALLOW:
            continue
        for ln in d.lines:
            if scannable(ln) and (m := rx.search(ln.text)):
                out.append(Finding("warn", "count", f"{d.path}:{ln.no}",
                                   f"引用位计数「{m.group()}」——只有正典文件可以写数量"))
    return out


# ---------------------------------------------------------------- main


def main(argv: list[str]) -> int:
    root = Path(__file__).resolve().parent.parent

    if "--list" in argv:
        print(f"受管数值注册表（{len(MANAGED)} 条）\n")
        for r in MANAGED:
            loc = r.canon_file + (f" 第「{' / '.join(r.canon_sections)}」节" if r.canon_sections else "")
            print(f"  {r.name:<12} 正典 {loc}")
            for f, why in r.allow:
                print(f"  {'':<12}   例外 {f} —— {why}")
            if r.why:
                print(f"  {'':<12}   {r.why}")
        print(f"\n提示词禁用措辞（{len(FENCE_BANNED)} 条，只扫围栏内）\n")
        for rx, why in FENCE_BANNED:
            print(f"  {rx.pattern:<24} {why}")
        print(f"\n  例外：")
        for f, s, why in FENCE_ALLOW:
            print(f"    {f} 第「{s}」节 —— {why}")
        print(f"\n章节标题守卫（{len(SECTION_LINKS)} 条，防重编号漂移）\n")
        for sl in SECTION_LINKS:
            print(f"  {sl.target_file.split('/')[-1]:<32} §{sl.section} 含「{sl.title_must_contain}」")
            if sl.why:
                print(f"  {'':<34} {sl.why}")
        return 0

    docs = load(root)
    by_name = {d.path.rsplit("/", 1)[-1]: d for d in docs}
    print(f"扫描 {root}，{len(docs)} 个 markdown 文件\n")

    findings = (check_links(docs, root) + check_sections(docs, by_name)
                + check_section_links(docs, by_name)
                + check_toc(docs) + check_managed(docs) + check_canon(docs)
                + check_counts(docs) + check_wording(docs))

    if not findings:
        print("干净。")
    else:
        width = max(len(f.where) for f in findings)
        for f in sorted(findings, key=lambda x: (x.level != "FAIL", x.kind, x.where)):
            print(f"[{f.level:4}] {f.kind:<8} {f.where.ljust(width)}  {f.detail}")

    fails = sum(f.level == "FAIL" for f in findings)
    warns = len(findings) - fails
    print(f"\n{len(findings)} 项，{fails} FAIL，{warns} warn。")
    print("注册表用 --list 查看；新增受管数值改 MANAGED，加例外要连理由一起写。")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
