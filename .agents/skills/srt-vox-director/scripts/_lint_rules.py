"""校验器的共享常量与读文件函数（内部模块）

这个 skill 反复栽跟头的错是「改了正典，下游复述过一遍的地方没跟」。
check_docs.py 用 MANAGED 注册表守 markdown 之间的漂移，但守不到代码里的常量副本
——它只扫 .md 不扫 .py。这个模块就是那唯一的代码侧正典：把各校验器里
**逐字相同**的常量收拢到一处，副本一旦分家，早晚会有一份漏改。

下游复述过一遍的地方没跟 = 副本迟早漂移。本文件就是来消灭副本的。

谁该 import 什么：
    check_storyboard.py : CLIP_LENGTHS, ENCODINGS, DENSITY_CAP
    check_prompts.py    : CLIP_LENGTHS, BANNED, read_text
    check_state.py      : CLIP_LENGTHS, DENSITY_CAP, read_text
    check_docs.py       : BANNED（只取常量，load() 仍自带）

check_storyboard.py 的 read_text 返回 (text, enc) 元组、check_docs.py 的 load() 还做
章节追踪，签名与语义都和这里那份不同，各自保留，不并进本模块。
"""

from __future__ import annotations

import re
from pathlib import Path

# 平台能生成的时长档。吸附表（storyboard-algorithm §5）、分界点 5/7/9、超限 11 秒线
# 全部锁死在这套阶梯上。state.json 的 clip_limits 字段写的就是它——不可配。
CLIP_LENGTHS = {4, 6, 8, 10}

# 按 storyboard-algorithm §1「解析前清洗」的顺序试编码。中文 SRT 在 Windows 上
# 最常炸的就是编码——剪映、Arctime 导出的常是 GBK。
ENCODINGS = ("utf-8-sig", "utf-8", "gb18030", "gbk", "utf-16")

# 解释型每镜文字上限，与 prompt-keywords「三档密度」一一对应。
# 校验器 9a 条直接查它，所以必须和文档同源。
DENSITY_CAP = {"minimal": 2, "standard": 5, "editorial-dense": 8}

# 提示词围栏内禁用的版式术语。模型只会「画什么」，没有「不画」这个动作：
# 收到「留出 8% 作为字幕边距」这种排版概念，它会把概念物化成一条可见的白色实体色块。
# 改法一律是正面说这块区域画什么——「这条带子里只有背景本身继续延伸」。
# 注意：check_prompts.py 与 check_docs.py 都靠这份，别各写各的。
BANNED: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"字幕边距"), "版式术语，模型会画成一条实体色块"),
    (re.compile(r"字幕安全区"), "「安全区」是给操作者看的说法，不进提示词"),
    (re.compile(r"留出\s*(约\s*)?\d+\s*%"), "不是可执行动作，改写成「只有背景本身继续延伸」"),
    (re.compile(r"底部留白"), "「留白」是版式概念，模型会物化成可见区域"),
]


def read_text(path: Path) -> str:
    """按 ENCODINGS 依次试，返回去掉 CRLF 的纯文本。

    逐字节照抄自三个校验器里原本那份 read_text：先试编码、
    解出来不含 U+FFFD 就用、全不行再 utf-8(replace) 兜底。
    """
    raw = path.read_bytes()
    for enc in ENCODINGS:
        try:
            text = raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
        if "�" not in text:
            return text.replace("\r\n", "\n")
    return raw.decode("utf-8", errors="replace").replace("\r\n", "\n")
