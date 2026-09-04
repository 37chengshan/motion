---
name: eduevidence-video-loop
description: "EduEvidence 系列视频（37chengshan/eduevidence-bilibili Remotion 工程）生产、评审与修复循环的经验库。用于：产出/修改 V1H/V1V 短视频时核对权威语义（介绍对象=Skill、真实模型池、9 步协议、角色=执行适配器）、机制动画原则（灰框预览/深墨文字/旁白对齐）、CosyVoice3 TTS 与硬字幕流程、响度统一、NVENC 渲染与 Windows 文件锁坑。先从本 skill 读权威清单与踩坑，再动手，避免重复返工（模型名单编造/画面旁白不同步/竖屏缩放/响度不一是最常见四类返工源）。"
metadata:
  agent_created: true
---

# EduEvidence 视频生产经验库（V1H/V1V 系列）

> 目标工程：`D:/motion/project/2026-09-01-eduevidence-bilibili/engine`（Remotion 4.0.518 + React）。
> 权威产品仓库：`D:/motion/code/eduevidence/`（SKILL.md 为 6.0 权威，不是本地视频缓存）。

## 0. 语义权威源（第一步，防止方向性返工）

- 视频介绍对象是 **EduEvidence 这个 Agent Skill**，不是独立产品；装进 AI 助手的用法要体现。
- 内容语义以产品仓库 `SKILL.md` + `integrations/agent_mcp.py` 为准：
  - **9 步协议**：Frame→Retrieve→Extract→Challenge→Audit→Adjudicate + Applicability→Intervene→Evaluate；Present 是投影层不是协议步。
  - **8 角色是执行适配器**，不是固定接力；Agent MCP 是可选增强（Mode B），无则降级 Platform Native（Mode A）。画面文案用"8 个角色 · 一种用法组合"。
  - 角色卡展示**能力需求**（ROLE_REQUIREMENTS：推理/速度/工具/结构化…），skeptic"最好异构模型家族"（advisory，不用"必须"）。
  - **真实模型池（2026 生态，禁止编造）**：
    - 高级(strong/推理裁决)：Claude Opus 5 · GPT 5.6 Sol · DeepSeek V4 Pro · Kimi K3 · GLM 5.3
    - 任务(fast/并发检索)：Claude Sonnet 5 · GPT 5.6 Luna · DeepSeek V4 Flash · GLM 5.3 Flash
    - 底座(CLI)：Claude Code · Codex · DSH · Kimi Code · ZCode · OMP（DSH/Kimi Code/ZCode = 国产）
  - 产品定位不只教育：**education + applied social science + AI tool/program/policy**。开场文案："决策级证据引擎…教学法、课程、AI 工具还是政策，都能先摆证据、再下判决"。
- **改文案必须三处同步**：口播(pronunciations.json tts_text/original) + 画面文字(scenes/*.tsx) + 字幕(subs_v1.ts 来源 make_v1_subs.py)。漏一处 = 返工。改完全仓 grep 旧词防残留（如 "Kimi K2 Code"/"教育决策"）。

## 1. 机制动画原则（engine/src/kit/mechanism.tsx v3）

- **灰框预览（ghost）**：未 trace 节点显示灰框（拓扑全貌从开场可见），到达时点亮 + 落定回弹——杜绝长时间空屏（旧实现 `if(a0<=0 && ghost) return null` 语义反了）。
- **彩色是编辑性**（对齐 diagram-design skill）：只有激活/焦点上彩色；未激活一律中性灰（边框/文字）。主标签**固定深墨 C.ink**（白字 bug 根因：把 noteY/noteG 等近白便签底色当主题色传入 → 白字白框不可见）。主题色只上边框/光圈/角标/呼吸。
- MechNode 字号随 size 缩放（≈0.22×，clamp）；MechEdge SVG viewBox 必须 vw/vh 参数化（竖版 1080×1920，写死 2000×1100 会裁边）。
- MechToken 到达终点后**落地脉冲 + 淡出**（"证据交付"语义），否则常驻卡盖住终点节点文字。
- 布局对齐：泳道/卡片用**绝对坐标并与节点中心严格对齐**；flex 居中与硬编码连线是 McpS 错位的根因（4 卡只有 3 线）。删繁：布局能表达就不画框（AgentS 用节点色分组+图例取代大泳道）。
- **旁白-动画逐字对齐**：按旁白词序的字符权重把 9 步时刻映射到 30fps 基准帧（TRACE 数组），节点在旁白念到该步时点亮。示例 FlowS：vo 挂 21.74s/10.28s → TRACE=[8,74,91,107,124,141,158,172,186,203,239]。
- 运镜：口播间隙不要空镜头运镜（V1 cam 全 none）；转场用轻弹 springTiming damping 32/stiffness 220、TRANS 30 帧。
- 竖屏 **1080×1920 独立排版**，绝不 scale(0.5625) 缩放横版（60% 留白+文字被切）。

## 2. 修复自检循环（每改必截图）

- `shot*.mjs` 模式：`bundle()` 一次 → `renderStill` 各场景关键帧 PNG（trace 完成时刻）→ 视觉诊断 → 修改 → 回归。
- 关键场景与取样秒：FlowS≈30s、AgentS≈47s、VerdictS≈58s、McpS≈68s、WebTourS≈88s、ReportCardsS≈95-99s（图表分波）、IntroS≈5s、ArchS≈16s；竖版同点。
- bundle 报 "Multiple exports with same name" = 旧函数体残留（替换脚本 start/end 越界），先 grep 清重。

## 3. TTS + 硬字幕（CosyVoice3）

- 只允许 `.venv/Scripts/python.exe`（系统 Python310 无 cosyvoice 依赖 → ModuleNotFoundError: hydra）。
- 重录：`python regen_only.py vo-x`（自动同步 engine/public/audio wav+mp3 + durations.json 需手更新）；speed 基准 1.35（v3 补偿）。超窗（口播长度 > 场景窗 - 尾呼吸 1.5s）→ 精简文案或 speed↑（1.5 实测约 -0.87× 时长）。
- 新生成到 out/new-vo/ 的需手动 ffmpeg 同步（regen_only 已自动；自写脚本不会）。
- pronunciations.json 双字段：`tts_text`（注音，如 "Kimi K二 Code"/"G L M"）+ `original`（可读版，如 "Kimi K2 Code"/"GLM"）——字幕与展示用 original。
- 硬字幕（burn-in）：`tools/voice/cosyvoice/make_v1_subs.py`（SUBS 文本字典 + VO_V1S 挂载点 + durations.json → 按字符比例切句）生成 `engine/src/subs_v1.ts` → `kit/subtitle.tsx SubtitleTrack` 挂 VideoBody（绝对时间轴，zIndex 60，横 33px/bottom34、竖 36px/bottom116、maxWidth 90%）。
- **V1 时间轴硬编码在 Root.tsx（不读 durations.json）**：口播长度预算 = 场景窗 − 尾呼吸；≤ 预算则无需重排全片。

## 4. 响度统一（成片后处理，免重渲染）

- 诊断：`ffmpeg -i seg.mp3 -af volumedetect`（mean_volume）逐段测。
- 根因案例：同批不同次录的段差 ~10dB。修法：成片音轨 ffmpeg 分段增益 + 限幅：
  `-af "volume=XdB:enable='between(t,a,b)',...,alimiter=limit=0.9" -c:v copy -c:a aac`
  轻段 +6~8dB、重段 −1~−2dB，target ≈ −18.5dB → 十段收敛 mean −20.5~−20.9（极差 ≤0.5dB），无削波。
- BGM 已在混音里 −43dB 相对口播很轻，不单独处理。

## 5. 渲染（NVENC）与 Windows 坑

- `engine/render_v1.mjs`：只渲 V1H/V1V（V2 搁置时），`hardwareAcceleration: "if-possible"`（→ h264_nvenc）+ concurrency 4，两条 ~20-23min。
- **文件锁 EPERM**：渲染收尾 rename `.remotion-in-progress → target.mp4` 时若目标正被播放器/预览占用 → EPERM。对策：渲到 `-new.mp4` 再手动改名；或先确认 out/*.mp4 未被打开。
- ffmpeg 路径必须 `D:/...`（Git Bash `/d/...` 不被 Windows ffmpeg 识别）；中文 Windows netstat 等输出要 `encoding="utf-8", errors="replace"`。
- Git Bash heredoc 会把正则 `\s` 变 `/s`（MSYS 路径转换）——写含正则/批量替换用 Python 脚本或 Write 工具。

## 6. 工程双方案并存（别改错线）

- `src/Root.tsx` 同时有 VideoBody（V1H/V1V/V2/B1，用户主用线，场景组件在 scenes/v1mech.tsx + v1short.tsx）
  与 CINE（V1H-CINE/V1V-CINE：src/video/* + src/scenes/cinematic/* + kit/mechanism/v3 + kit/camera + SubtitleLayer，独立 v3 mechanism 组件体系）。
- 两条线改动互不影响；对 CINE 动手前先确认用户当前迭代的是哪条。

## 7. 交付

- 成片：`engine/out/eduevidence-v1h.mp4`（1920×1080）/ `eduevidence-v1v.mp4`（1080×1920），~111s / 32MB，h264+aac。
- B 站章节：按 Root.tsx V1S_SEG 场景边界给 HH:MM:SS（间隔 ≥5s），十一节：00:00/00:10/00:21/00:33/00:50/01:00/01:11/01:23/01:32/01:42/01:52。
- git：本地 commit 即可；push 需用户确认（37chengshan/eduevidence-bilibili）。
