# srt-vox-director

## 风格库

21 种，编号连续。**全部用同一个题材、同四件物件、同四处中文生成，唯一变量是风格本身**，
所以下面这张图可以直接横向比：

![21 种风格样图](assets/style-grid.jpg)

风格不是滤镜，是一整个解释世界——选定后要贯彻到视觉隐喻、主体构建、文字载体、
运动动词、音效、转场，而不只是背景材质。

---
把一份**已经写好的 SRT 字幕**，变成可以直接复制去生图、生视频的提示词包。

大多数同类工具从一个选题开始，替你写脚本、配音、渲染，最后吐一个 MP4。
这个 skill 反过来：**旁白已经存在**，它只负责从字幕到画面的那一段——
按语义切分镜、锁死视觉圣经、逐镜产出参考图提示词与图生视频提示词。

**它不生成任何图片或视频。** 交付的全部是文本，图和片子由你在自己选的平台上生成。
「给我提示词」不等于允许生成媒体，这条在任何模式下都不放宽。

**所有提示词都用中文写。** 风格块、参考图提示词、视频提示词、负面约束，一律中文。

## 为什么是 SRT 驱动

旁白全文开局就有，这带来三个同类工具拿不到的好处：

- **选风格不用猜。** 通读全文就能判断题材、信息形状、观众情绪，按七个维度打分推荐，
  而不是靠用户一句「我想要科技感」去猜。
- **切分镜有硬边界。** 镜头时长不是编出来的，是从时间码算出来的，
  因此可以校验：镜头必须无缝覆盖整条时间轴，不留空洞、不重叠。
- **音画对不上有解。** 平台只能生成 4/6/8/10 秒，与旁白的差值被显式算出来、
  分正负两种写法编排进提示词，剪辑时一步处理，不会累积漂移。

## 五个模式

| 模式 | 做什么 |
|---|---|
| 1 选风格 | 从 21 种里推荐三种、展示样图，定下风格 DNA 与视觉圣经 |
| 2 切分镜 | 读 SRT，按语义切分并就近吸附到 4/6/8/10 秒，输出分镜表 |
| 3 出完整包 | 主模式。分批输出参考图提示词与视频提示词 |
| 4 局部补出 | 只重出某一镜 |
| 5 诊断修复 | 出图或出片失败时，按症状定位并做最小必要改写 |

默认链路 `1 → 2 → 3`，每步停下来等确认。直接扔一个 SRT 进来就从模式 1 开始。

## 快速开始

```
把 story.srt 做成解释视频的提示词包
```

它会依次：读完字幕判断题材 → 推荐三个风格方向并给出样图 → 你选定后出分镜表和规模提示
→ 确认后分批产出提示词。几十镜的片子会写 `state.json`，回来说「继续」就接着跑。

拿到提示词之后的链路是：图片平台生成 PNG/JPG（**这个文件才是参考图**）→
图生视频工具上传该图并粘贴视频提示词 → 下载 MP4 → 连同旁白与字幕导入剪辑。
默认路线 ChatGPT Images → Google Flow → 剪映，可以换成任何同能力的平台。

这张参考图画的是这一镜的**目标构图**，上传后模型把它当垫图、重新生成第 0 帧并演化——
所以生成片的第 0 帧与上传图常常并不一致，这是正常的。

## 项目结构

```
srt-vox-director/
├── SKILL.md                          路由与判定规则，不复述任何表格
├── assets/
│   ├── style-grid.jpg                21 张样图拼在一起的横向对比图
│   ├── style-samples/                S01–S21，同题材同构图的单张样图（给用户选风格）
│   ├── style-highlight/              S01–S21，分界特写（给用户分辨易混的两条）
│   ├── style-board/                  S01–S21，六格风格板（给图像模型，出图时上传）
│   ├── sample-prompts.md             统一变量版样图提示词（21 条，中文）
│   ├── style-highlight-prompts.md    分界特写提示词（21 条，中文）
│   └── style-board-prompts.md        风格板提示词（21 条，中文）
│                                     三份都只在重出图时读，
│                                     正常流程不要读进上下文
├── examples/
│   ├── end-to-end.md                 一个完整走通的范例
│   └── storyboard-examples.md        分镜算例（从 storyboard-algorithm 移出）
├── scripts/
│   ├── _lint_rules.py                校验器共享常量（CLIP_LENGTHS / BANNED / read_text）
│   ├── check_storyboard.py           分镜表校验器，出片前跑
│   ├── check_prompts.py              逐镜提示词校验器，每批写完跑
│   ├── check_state.py                state.json 校验器，续跑前跑
│   └── check_docs.py                 文档一致性校验器，改文档后跑
├── tests/
│   ├── test_checkers.py              校验器回归测试（stdlib unittest）
│   └── fixtures/                     good/ 已知全过的 3 镜项目，bad/ 故意埋 FAIL
└── references/
    ├── style-gallery.md              样图索引与评级
    ├── style-library.md              21 条风格块（可直接粘贴的中文）
    ├── style-selector.md             七维打分与自定义风格 DNA
    ├── storyboard-algorithm.md       分镜算法、吸附表、差值、拆分、校验器
    ├── storyboard-blueprints.md      九类题材的专属切镜策略
    ├── prompt-templates.md           模板正典与无效写法对照
    ├── prompt-keywords.md            上屏文字、渲染路线
    ├── prompt-motion.md              参考图角色、运动库、收束动作、桥接帧
    ├── delivery-contract.md          输出段落结构、目录结构、state.json
    ├── delivery-handoff.md           新手平台交接
    └── troubleshooting.md            失败症状的定位与修法
```

references 按流水线阶段用四个前缀分组：
`style-`（模式 1）→ `storyboard-`（模式 2）→ `prompt-`（模式 3/4）→ `delivery-`（交付）。
前缀只表示归属，不表示读取顺序——`ls` 是字母序，和上面这条流水线正好相反。

**每个口径与公式只有一处正典。** SKILL.md 只做路由，不复制表格；
引用正典的地方一律写明在哪个文件第几节，避免副本各自漂移。

## 几条不肯让步的规则

**一镜一个知识点。** 语义完整是硬约束，时长贴靶是软优化，差值最小可以牺牲，
顺序不可颠倒。为了凑时长把两个知识点塞进一镜，是这个 skill 定义的最严重错误。

**吸附就近，不是向上。** 分界点 5/7/9。4.9 秒的旁白配 4 秒的片子（补差 0.9，末帧定格补上），
不是配 6 秒（白多 1.1 秒还得编个收束动作去填）。

**参考图画目标构图，带字的东西必须在参考图里就印好。** 上传图是垫图，
模型重新生成第 0 帧并演化到终态，所以参考图画的是这一镜想呈现的核心画面。
带字载体只能在画面里就位、贴合、展开、被揭开，
不能从画外飞入——那等于让视频模型自己造汉字，字必漂。无字部件不受此限。

**展示型镜头的上屏文字必须完整覆盖旁白。** 一个字都不许压缩。
超 14 字块的行拆成多张卡——拆卡，不是砍字。

**同一镜内不许有两个文字载体长得像。** 实测中最常见的失败就是四个标签做成四个一样的圆角矩形，
逐个写明形状、材质、尺寸差异。

**提示词里每条约束都要附一个可执行的物件或动作。**
「不要留空」无效，「底部加一排标本架，每块底座留空白」有效；
「要有动感」无效，「纸卡从左侧滑入 140 像素，顺时针转 3 度，回弹一次后停稳」有效。

## 输出

```
<SRT 所在目录>/
├── your.srt                你的输入
├── state.json              断点续跑状态
├── storyboard.md           分镜表 + 关键词台账
├── 01_提示词/              视觉圣经、逐镜参考图提示词与视频提示词、剪辑与后期
├── 02_参考图/              你存：SNN_reference.png
├── 03_生成视频/            你存：SNN_clip.mp4
└── 04_成片/                你存：剪辑导出
```

产出直接落在 SRT 所在目录，不另建子目录。
`state.json`、`storyboard.md` 与 `01_提示词/` 由 skill 写，另外三个目录留给你存在别的平台生成的媒体。

---

## 参考借鉴

| star | 项目 |
|---:|---|
| 1085 | [Alisa0808/vox-director](https://github.com/Alisa0808/vox-director) |
| 178 | [MegaTroll222/VOX-COLLAGE-BROLL](https://github.com/MegaTroll222/VOX-COLLAGE-BROLL) |
| 161 | [cyberlesterr/paper-collage-video](https://github.com/cyberlesterr/paper-collage-video) |
| 132 | [Anil-matcha/vox-ai-motion-graphics-generator](https://github.com/Anil-matcha/vox-ai-motion-graphics-generator) |
| 77 | [CK42BB/vox-explainer-skill](https://github.com/CK42BB/vox-explainer-skill) |
| 54 | [louchi1984-coder/voxeasy](https://github.com/louchi1984-coder/voxeasy) |
| 18 | [Phantomlau3674/voxstylehub-steven](https://github.com/Phantomlau3674/voxstylehub-steven) |

