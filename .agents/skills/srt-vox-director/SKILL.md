---
name: srt-vox-director
description: 把已经写好的字幕（SRT / 配音稿 / 解说词 / 旁白稿）变成 Vox 风格解释视频的分镜与提示词包——参考图提示词、图生视频提示词、分镜表、关键词台账、视觉圣经、风格选择。只交付文本提示词，不生成任何图片或视频。适用于用户已有成片旁白、想做成分镜或配画面、需要切分镜头与处理时长差值、选定视觉风格，或出图/出片失败后诊断修复（字错了、画面没动、风格跑偏等）。
---

# SRT 解释视频导演

把一份已经写好的 SRT 字幕，变成可以直接复制去生图、生视频的提示词包。
**所有交付的提示词都用中文写**——风格块、参考图提示词、视频提示词、负面约束，一律中文。

「Vox 风格」在这里指：强解释性的信息编排、可触摸的实体信息物件、清晰的编辑层级、有物理意义的运动。
不得暗示与 Vox Media 有关联、不使用其标识、不逐镜复刻任何已发布视频。

## 路由：选最小够用的模式

1. **选风格** —— 从风格库里推荐三种并展示这三张样图，定下风格 DNA 与视觉圣经。
   **不要一次抛出全部**，用户想看更多时才按分组展开。
2. **切分镜** —— 读 SRT，按语义切分并就近吸附到 4/6/8/10 秒，输出分镜表。
3. **出完整包** —— 主模式。分批输出参考图提示词与视频提示词。
4. **局部补出** —— 只重出某一镜的提示词。
5. **诊断修复** —— 出图或出片失败时，诊断并做最小必要改写。

默认链路 `1 → 2 → 3`，每步停下来等用户确认。用户直接扔 SRT 且未说别的时，从模式 1 开始。

**模式 4 与模式 5 怎么分**——用户说「第 7 镜不对」时不要猜：

```
画面已经生成了、结果不对          → 模式 5，先定位症状再最小改写
画面还没生成 / 要换内容或换角度   → 模式 4，重出该镜提示词
分不清就问一句：你是已经生成了觉得不对，还是还没生成想先改？
```

模式 5 **需要用户描述症状**。只说「不对」时，先拿 troubleshooting 的症状索引表反问是哪一种，
不要凭空猜着改——猜着改会同时动几处，用户无法判断是哪一处生效。

「给我提示词」不等于允许生成媒体。本 skill 在任何模式下都不生成图片或视频。

## 按需加载参考

| 什么时候 | 读什么 |
|---|---|
| 任何完整交付 | [references/delivery-contract.md](references/delivery-contract.md) —— 输出段落结构、目录结构、state.json、用户自检表 |
| 模式 1 | [references/style-gallery.md](references/style-gallery.md) 样图索引 · [references/style-selector.md](references/style-selector.md) 七维打分 · [references/style-library.md](references/style-library.md) 风格块本体（只取选中那一条） |
| 模式 2，**必读** | [references/storyboard-algorithm.md](references/storyboard-algorithm.md) —— 不得凭经验切分镜 |
| 需要题材专属的切镜策略 | [references/storyboard-blueprints.md](references/storyboard-blueprints.md) |
| 写任何参考图或视频提示词之前，**必读** | [references/prompt-templates.md](references/prompt-templates.md) |
| 画面有任何上屏文字（中文、英文、数字皆算），**必读** | [references/prompt-keywords.md](references/prompt-keywords.md) |
| 涉及**参考图画法**、运动、组装方向、桥接帧、余量收束与补差 | [references/prompt-motion.md](references/prompt-motion.md) —— 第 6 节是参考图角色与组装方向的唯一正典 |
| 模式 5，出图或出片失败 | [references/troubleshooting.md](references/troubleshooting.md) —— 按症状索引定位与修法 |
| 用户是新手，或问「从哪开始」「参考图哪里来」「传到哪」，**必读** | [references/delivery-handoff.md](references/delivery-handoff.md) |
| 需要端到端范例时才读 | [examples/end-to-end.md](examples/end-to-end.md) |
| 需要分镜算例时才读 | [examples/storyboard-examples.md](examples/storyboard-examples.md) |
| 分镜表交付前，有 Python 就跑 | `python scripts/check_storyboard.py <项目>/storyboard.md <字幕>.srt` —— 算术类一次判掉，语义类仍要人工 |
| **每批提示词写完后**，有 Python 就跑 | `python scripts/check_prompts.py <项目>` —— 扫模板有没有被完整粘贴：三层齐全、图生视频专用硬约束、反泄漏三行、锁定块两半、禁止逐字动画、版式术语、风格板路径全片是否同一张。选得对不对仍要人工 |
| **改动本 skill 的文档之后**，有 Python 就跑 | `python scripts/check_docs.py` —— 扫断链、章节引用、目录、受管数值外泄、引用位计数、提示词里的版式术语，以及自称「唯一正典」的小节是否都有受管数值守着 |
| **续跑前**，有 Python 就跑 | `python scripts/check_state.py <项目>` —— 三向对账 state ↔ storyboard ↔ 提示词、style_id 一致、batch_size 与分档表、clip_limits、scale 自洽。续跑前先跑它，避免镜号错位 |

## 正典索引

**每个口径与公式都只有一处正典。** 本文件只做路由与判定，不复制表格——查数就按下表跳。

| 要查什么 | 正典在哪 |
|---|---|
| 参考图画什么、上传图与第 0 帧的关系、桥接抽帧 | prompt-motion 第 6 节 |
| 组装方向 `motion_dir`、正向/反向组装怎么画怎么写 | prompt-motion 第 6 节 |
| 展示型的动感预算三档、读字保护区 | prompt-templates 第 5 节 |
| 收束动作 / 微动填充动作库 | prompt-motion 第 3 节 |
| 运镜库、转场锚点、锚点零位移、换层转场 | prompt-motion 第 4、5 节 |
| 景别轮换、装饰物件预算、厚度线索的落点 | prompt-templates 第 4 节 |
| 每条风格的厚度线索、换层动作、装饰物件清单 | style-library 各风格块 |
| SRT 解析与清洗、`raw_text` / `clean_text` 双轨 | storyboard-algorithm 第 1 节 |
| 吸附表与差值方向 | storyboard-algorithm 第 5 节 |
| 尾部契约（末段静止 + 关键动作截止） | storyboard-algorithm 第 6 节 |
| 超限拆分与桥接帧 | storyboard-algorithm 第 7 节 |
| 规模公式与批大小 | storyboard-algorithm 第 9 节 |
| 分镜表列定义 | storyboard-algorithm 第 10 节 |
| 校验器 | storyboard-algorithm 第 11 节 |
| 计字口径（字块怎么数） | prompt-keywords「计字口径」 |
| 文字密度与两型上限 | prompt-keywords「三档密度」 |
| 关键词台账字段 | prompt-keywords「关键词台账」 |
| 视觉任务五类 | prompt-templates 第 1 节 |
| 参考图 / 视频 / 桥接 / 负面模板 | prompt-templates 第 4、5、6、7 节 |
| 输出结构、目录、`state.json` | delivery-contract |
| 样图评级与默认三选 | style-gallery |

两条防漂移的规矩，**`scripts/check_docs.py` 会逐条扫**：

- **引用方一律不写数量。** 「共 N 列」「N 条」「N 个字段」只允许出现在正典文件自己那一节里。
- **只有判定阈值留在本文件，执行参数不留。**
  判定阈值决定走哪条路，不查就没法决定读哪个文件：分界点 5/7/9、11 秒拆分线、
  3 秒短镜线、20% 差值率。
  执行参数决定写什么内容，用到它时 prompt-templates 已经必读了：末段静止时长、
  关键动作需留、展示型入场时间、文字数上限、字块范围。

## 建立项目档案

从用户输入提取字段（SRT 路径、编码、画幅、平台、风格、文字密度、是否新手）——
完整字段清单见 [delivery-contract.md](references/delivery-contract.md) 第 1 节「项目简报」。
**两条由本文件负责的判定**：

- **输出目录默认 = SRT 文件所在目录**，不另建子目录；用户指定别的路径才改，并在简报里写明。
- 只有当某个缺失项会**实质改变结果**时才提问，其余直接声明合理假设并继续。

## 先选风格

用户未指定时：读 SRT 全文判断题材 → 按 style-selector 七维打分 →
推荐三个**解释世界与运动逻辑都不同**的方向（不能只换配色）→ 展示样图让用户看图选。
**展示样图 = 推文件或给路径 + 文字描述；绝不把样图读进上下文**——评级与取舍 style-gallery 表里已有。

「你定」按**说的时点**分两种，不要混：

- **一开局就说**「你定 / 随便」→ 跳过打分，直接取风格库第一位 S01，省一轮往返；
- **三选展示后才回**「你定」→ 取**七维打分第一名**（分都打了，信息量比默认值大）。

风格一旦锁定，后续任何模式都不得更换，除非用户显式要求。完整选型流程、
自定义风格与混合风格规则见 [style-selector.md](references/style-selector.md)。

## 切分镜

完整算法、吸附表、差值处理、超限拆分见
[references/storyboard-algorithm.md](references/storyboard-algorithm.md)。以下三条是判定规则，不可让步。

**一 · 先给每一镜定型**，两型的处理路径完全不同：

| | 解释型 | 展示型 |
|---|---|---|
| 判据 | 旁白在**解释**某个东西 | 旁白在**朗读**一块要给观众逐字读完的内容 |
| 生成时长 | 就近吸附到 4/6/8/10 秒 | 取最接近自然时长的一档，超 10 秒取 10 |
| 超 11 秒 | 拆分 + 桥接帧 | 不拆分，封顶 10 秒；但自然时长 > 15 秒或文字拆满卡数上限仍装不下时，按内容分成两个展示镜（见 storyboard-algorithm 第 2 节例外） |

展示型的上屏文字必须**完整覆盖本镜旁白**，一个字都不许压缩——超长拆成多张卡，不是砍短。

**二 · 三级优先级不可颠倒：** 语义完整（一镜一个知识点）> 时长贴靶（4/6/8/10）> 差值最小。
为凑时长把两个知识点塞进一镜，是本 skill 最严重的错误。

**三 · 吸附就近，不是向上**，分界点 5 / 7 / 9。由此得到硬规律：
自然时长 ≥ 3 秒时 |差值| ≤ 1.0 秒；例外是 `短镜`（< 3 秒）与展示型封顶（> 10 秒），都要在分镜表标出。
差值正为余量、负为补差，档位与可粘贴文本全在 storyboard-algorithm 第 6 节的尾部契约表。
差值率超过 20% 时必须向用户提示并给三个选项。

分镜完成后、进入模式 3 之前，**必须先给规模提示**（总镜数、参考图张数、片段条数、
预计调用、批大小）。公式在 storyboard-algorithm 第 9 节——别拍脑袋写「三数相等」，
拆分镜会打破它。

## 出提示词

提示词的字段清单、可粘贴模板、写作准则（禁令 vs 可执行动作、结构 vs 创意约束、
精确数量正反两说、`待核实` 标注）全在
[prompt-templates.md](references/prompt-templates.md)（写之前必读，第 4/5/8 节），
参考图画法、组装方向、桥接帧在 [prompt-motion.md](references/prompt-motion.md) 第 6 节，
关键词台账与文字渲染路线在 [prompt-keywords.md](references/prompt-keywords.md)。
本文件不复述这些正典——**写之前按按需加载表读对应文件**。

## 分批与断点

批大小分档表见 storyboard-algorithm 第 9 节。**提示词正文一律写文件、对话只回摘要**
（一镜一文件 `01_提示词/S01.md`，对话只给镜号一览 + 写了哪些文件 + 进度块 + 「回复继续」）。
完整规则、三种贴全文的例外、`state.json` schema 见
[delivery-contract.md](references/delivery-contract.md) 第 10 节。

用户回来时先读 `state.json` 续跑，不要重新开始。**有 Python 就先跑
`python scripts/check_state.py <项目>`**——它一次性三向对账（state ↔ storyboard ↔ 提示词）、
style_id 一致、batch_size 与分档表、clip_limits、scale 自洽，全过才往下续。
对不上说明用户手动改过分镜表，**停下来问，不要闷头往下出**——镜号会全部错位。

## 向新手解释平台交接

新手不一定知道提示词、参考图、上传图的区别。完整话术、逐步操作清单、
常见卡点、默认路线（ChatGPT Images → Google Flow → 剪映）全在
[delivery-handoff.md](references/delivery-handoff.md)。**必讲的两条**：
参考图由提示词生成（不是预置文件）；参考图画的是目标构图，上传后模型重生成第 0 帧、
与上传图不必一致。

## 交付前验收

三份清单各有唯一正典，逐条硬检查：

| 检查对象 | 清单在哪 |
|---|---|
| 分镜表 | [storyboard-algorithm.md](references/storyboard-algorithm.md) 第 11 节校验器 |
| 上屏文字与载体 | [prompt-keywords.md](references/prompt-keywords.md)「验收清单」 |
| 用户自检（参考图 + 视频片段两张表） | [delivery-contract.md](references/delivery-contract.md) 第 8 节 |

逐镜提示词交给 `scripts/check_prompts.py`，别靠肉眼数（每批写完跑一次）。
它查的是模板有没有被完整粘贴——**选得对不对仍要人工**。

另外六条由本文件负责，不在上述清单里：

- 每条参考图提示词都含本镜旁白原文、视觉任务、**本镜知识点**、带固定约束句的三层结构、
  连接元素、视觉焦点、完整硬性约束，且**风格块是整段原样取用**（含配色角色与三层纵深两栏）；
- 每条参考图提示词都写明了本片风格板的路径，并带着反泄漏三行；
- 参考图提示词画的是这一镜的目标构图（不是待填底板），带字载体在参考图里就已印好，
  且没有让带字载体从画外飞入；
- **同一镜内没有两个文字载体长得一样**——逐个写明形状/材质/尺寸差异，
  ≥3 个载体时至少覆盖 2 个类别（字段定义见 prompt-keywords「关键词台账」）；
- 无媒体标识、水印、随机文字、未授权模仿、未核实事实；
- 已交付用户自检表，并已声明本次未生成任何媒体。
