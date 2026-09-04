# Motion 项目长期笔记

## 项目定位
单仓库双运行面 + 公网控制面的每日视频生产发布系统。
- `producer/` Windows 生产端（研究/写稿/TTS/渲染/审查/签名打包）
- `publisher/` Mac 发布端（只验包+发布，不跑 TTS/FFmpeg/模型）
- `cloud/` Cloud Run 控制面（Firestore 索引 + GCS 中转）
- `contracts/` 共享契约（PackageManifest Schema + JCS/Ed25519 向量）

回归入口：`bash tools/run-verification.sh`（7/7）、`cd publisher && python -m pytest`（24 项）。

## Skill 资产约定（2026-08-29 同步至 WorkBuddy）
- **双源**：项目内 `.agents/skills/`（项目级 `--copy` 安装）+ 用户级 `~/.claude/skills/`（CLI 自带上游）
- **权威清单**：`skills.lock.json`（29 条）+ `skills/manifest.json`
- **digest 算法**：`sk_md_digest = sha256(去BOM + CRLF→LF 的 SKILL.md)`，已用 17 样本验证
- `source_tree_digest` 是 CLI 未公开算法，**不可复现**，漂移时保留原值并标记 stale
- 3 个项目内编排 skill：`motion-design`（镜头→动效）、`video-agency-roles`（七层质量门）、
  `motion-media-handoff`（素材/音频/字幕/渲染交接）
- `motion-media-handoff` 原名 `hyperframes-media`，因与 HeyGen 官方原子 skill 同名而改名。
  **官方 `hyperframes-media` 是 TTS/BGM/SFX 音频引擎（带 scripts/audio.mjs），被 6 处引用，不可改名**
- 已装 29 个到 `~/.workbuddy/skills/`（用户级），锁文件已同步回写
- **双位置布局**：3 个项目内编排 skill（`motion-design`/`video-agency-roles`/`motion-media-handoff`）
  同时存在用户级与项目级 `D:/motion/.workbuddy/skills/`（**复制，非移动**，用户级保留）。
  项目级内容强绑定 `runs/<date>/<run>/` 路径；改动任一份后需手动同步另一份，否则会分叉

## 环境陷阱
- **Git Bash heredoc 会把正则里的 `\s` 转成 `/s`**（MSYS 路径转换）。写含正则的脚本必须用 Write 工具
- 沙箱出口代理拦截字面路径 `/healthz` 与 LB IP 直连；云端真实验证需从用户网络执行
- **Python 大件安装（Windows 生产端）**：官网 download.pytorch.org 被墙（0 B/s）；清华 PyPI 大 wheel 403；
  腾讯云 PyPI simple（`mirrors.cloud.tencent.com/pypi/simple/`）对普通包 200 可用；CUDA wheel 走
  `mirrors.aliyun.com/pytorch-wheels/cu128/`（`+cu128` 本地版本标识无法用 `==` 匹配 pip 索引，
  必须**直接下 wheel 文件再本地安装**）；单线程 ~130KB/s，多线程分段可到 1MB/s+
- **embed-server 环境**：`tools/embed-server/.venv3`（Python 3.10.11）；torch 2.11.0+cu128 匹配
  RTX 5060（Blackwell sm_120，需 cu128+）；pip 缓存指 `D:/motion/.pip-cache`（C 盘不放）
- **Qwen3-VL-Embedding-2B 正确 API**：官方是 `scripts/qwen3_vl_embedding.py` 的
  `Qwen3VLEmbedder(model_path).process([{text|image|video}...])`（fps/max_frames 控视频采样），
  **没有** `encode_text/encode_image/encode_video` 方法（transformers 直接 AutoModel 加载没有嵌入 API）；
  模型 config 声明 transformers 4.57.1，但 transformers 5.16.1 实测可用
- **视频嵌入三大坑（已踩平）**：
  1. 视频读取后端：torchvision 0.26 移除了 read_video / torchcodec DLL 缺依赖 / decord 不支持
     `file://` → **ffmpeg 抽帧传帧路径列表**（走 fetch_image 分支，绕开视频后端）
  2. transformers 5.16 的 Qwen3VL 视频处理**默认不启用 cap_pixels_per_frame**，短片段耗尽整段
     像素预算（4 帧 560×316 → 6060 tokens 前向 74.5s）；`embedder.processor.cap_pixels_per_frame=True`
     后 32.6s（8 帧 34.2s）。input_ids 长度不变（固定预算），耗时减半来自计算量变化
  3. 抽帧用 `-ss` input seek 均匀抽帧（t_i=(i+0.5)*dur/n，单进程多输出）0.43s/106s 视频，
     比 fps 滤镜（3.2s，且超低 fps 触发 muxer bug）快 7.5 倍；抽帧时 scale 最长边 560
- **manage.py 陷阱**：Windows venv python.exe 是 launcher（Popen pid ≠ 真服务），health up 后须按
  端口校准 pid 文件；netstat 中文 Windows 输出 GBK，subprocess text=True 要 `encoding="utf-8",
  errors="replace"`（默认 utf-8 会 UnicodeDecodeError 导致 stdout=None）；独立脚本与服务同跑
  会 GPU 争用（0xC0000002 原生崩溃）
- **Chrome cookie 采集（X 等需登录站点）**：Chrome 127+ cookie 全 v20（App-Bound Encryption，
  base64 前缀 `djIw`），绑定 Chrome app-bound service，**用户态无法解密**（v10 DPAPI+AES-GCM
  方案失效）；Chrome 152 默认 profile 拒绝 `--remote-debugging-port`（独立 `--user-data-dir`
  正常）。**可靠方案：独立 profile 专用浏览器（`D:/motion/data/x-browser/` +
  `--remote-debugging-port=9223` 窗口模式）→ 用户登录一次 → CDP `Network.getAllCookies` 拿
  明文 cookie**。X API 需走代理（`curl -x http://127.0.0.1:7890`；Node fetch 不读系统代理、
  undici ProxyAgent 在此环境失败）；X 对 curl 返回 200 空壳，采集走 CDP DOM 提取
  （`article[data-testid="tweet"]`）
- **sympy/mpmath 陷阱**：sympy 1.14 要求 mpmath<1.4；强制装 mpmath 1.4.1 会 circular import 报错，
  必须 `--force-reinstall "mpmath==1.3.0"`

## CosyVoice 部署实况（2026-08-31 确认，防误判）
- **位置**：`tools/voice/cosyvoice/`（FunAudioLLM 官方仓库 + `.venv` torch 2.7.1+cu128 cuda:True +
  modelscope 1.20.0 + fastapi/uvicorn）
- **CosyVoice2-0.5B 完整可用**（5.3G：llm.pt/flow.pt/hift.pt）；参考音频 `out/clone_female3.wav` +
  转写 `prompt_text.txt`；生产脚本 `regen_audio.py`（27 段→EduEvidence engine/public/audio + durations.json）
- **日常用法是脚本直调**（synth.py/regen_audio.py 的 `AutoModel.inference_zero_shot`），**不是 HTTP API**；
  producer 流水线 `tts-cosyvoice.py` 的 HTTP 后端（`COSYVOICE_API_URL` + 9880）从未激活，流水线走 edge-tts，
  两套独立
- **Fun-CosyVoice3-0.5B-2512 已落地**（6.5G：llm.pt 1.9G / flow.pt 1.3G / hift.pt 80M / speech_tokenizer_v3.onnx 925M；
  spk2info.pt 缺失无害，前端 `os.path.exists` 兜底）：ModelScope `FunAudioLLM/Fun-CosyVoice3-0.5B-2512`
  - **prompt_text 必须带前缀** `You are a helpful assistant.<|endofprompt|>`（v3 特有 LLM 内部 `assert 151646 in text`）
  - **v3 比 v2 慢 1.23×**：v2 speed=1.1 基准下时间轴适配，**v3 需 speed=1.35 补偿**（实测 vo-s1 26.28→21.88s）
  - 支持 instruct2/fine-grained/vllm
  - **多进程同时加载 6.5G 模型会 OOM 互相争 GPU**——单实例独占 GPU 才是稳定的
- **去谐音策略**：EN_MAP 删除所有中文近音（给特哈布/迪普西克/克劳德/派森/科戴克斯/欧普斯/桑内特/奇米/索尔/阿奇法伊/欧鹏马努斯/赫奇斯），
  仅保留逐字母展开（EduEvidence→E D U Evidence / AI→A I / GPT→G P T / MCP→M C P），CosyVoice3 中英混合直接读英文音
- 关键脚本：用户自写 `regen_cv3.py`（14:33 创建，v3 版，fp16=True，默认输出 `out/new-vo-cv3` 不覆盖，`--sync` 才同步）+ `regen_audio.py`/`regen_only.py`/`run_resynth.py`（已改 v3+1.35+endofprompt）
- 验证命令：cd tools/voice/cosyvoice && .venv/Scripts/python.exe synth.py --text ... --prompt out/clone_female3.wav
  --prompt-text "$(cat prompt_text.txt)" --out out/vo.wav

## 机制动画（archify trace 模式，2026-08-31 落地）
- 用户语义："根据框架什么的做 2D 动画（不是入场/转场，是内容机制在动）"——表达系统如何运行
- 参考 archify (github.com/tt-a1i/archify) 的 `meta.animation: "trace"` 主路径 trace 模型
- 实现：`engine/src/kit/mechanism.tsx` v2 版本，对齐 archify 节点/边/主路径数据模型
  - `MechFrame` 横版原样 / 竖版 scale 0.5625 居中
  - `MechNode` trace 激活（出现→呼吸→主路径到达亮起）+ ghost 模式 + 角标 + 彩色高亮
  - `MechEdge` 主路径边（到达前灰虚线，到达后亮起 + 信号点 + 标签 + 流动 dash）
  - `MechToken` 沿节点序列流动的证据/任务包
  - `MechLane` 泳道/阶段分隔
- 必为确定性：只用 anim()/useF()/interpolate()，无 Math.random，可 seek
- 项目内编排入口：`engine/src/scenes/v1mech.tsx` 4 个机制场景（FlowS 9 步证据流 + AgentS 8 智能体接力 + VerdictS 法庭判决 + McpS 协议桥+交叉验证）
- 视觉风格约束：与 motion-design skill 一致（无入场/转场动画误用）

## 安全基线（硬性）
- 密钥一律环境变量注入（`CONTENT_*`/`AIPING_*`/`AGY_*`/`DEVICE_TOKEN_PEPPER` 等），
  代码/日志/契约中绝不出现原文
- Mac 不运行 TTS/FFmpeg/HyperFrames/Remotion/模型
- 最终发布只能由 operator 消费一次性 TTL nonce 触发，无自动授权

## 当前最高优先级
CLAUDE.md 待办第 0 条：**AI 新闻内容侧大改重构**——搜索（research/score 选题）与视频内容生成。
- 采集侧已就绪：AIHOT 主源（ai-news-handbook 用户定）+ 29 信源 + X 官方 170 条 + 微博官方 375 条
- **视觉三轨已闭环（2026-08-31 commit 8be0672）**：generate-content 产出 media 需求 →
  media-orchestrate 批量生成/导入回填（AIPING doubao-seedream-4.0 等）→ BlockRenderer chart 真渲染
- 写稿：generate-content.ts（DeepSeek-V3.2 直调，数字提取质量门 + max_tokens=8192 已修）
- 配音：CosyVoice2 脚本直调可用（见上节）；3.0 下载中

## video-talkcraft / Remotion 渲染环境（2026-09-03 踩平，复用）
- **video-talkcraft skill**（~/.workbuddy/skills/）核心管线：口播稿 → 配音(输入) → timestamps_cpu.py(ASR词级) → make_timing.py(timing.json) → Remotion `Subtitles` 组件词锚字幕。配音非 skill 产物，本机用 CosyVoice3/edge-tts 皆可。
- **Remotion 4.0.518 Windows 渲染三坑**：① `@remotion/compositor-win32-x64-msvc` 原生二进制代理被截断 → 从 `producer/node_modules/@remotion/compositor-win32-x64-msvc/` 整目录拷到工程的 `node_modules/...`；② chrome 用 `D:/motion/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe`，**必须 Windows 盘符 `D:/...` 路径传给 `--browser-executable`**（Git Bash 的 `/d/` 不翻译给 node）；③ `Easing.backOut` 在 4.0.518 **不存在** → 用 `Easing.bezier(0.34,1.56,0.64,1)`。
- **字级时间戳代理坑**：HF 经 127.0.0.1:7890 把 faster-whisper 模型下成 0 字节（仅 model.bin 偶经 hf-mirror curl 走通）。无 ASR 时的兜底：**逐句合成 CosyVoice 记录每句起止**（`segments.json` + 线性插值 build_timing.py → timing.json，schema 同 make_timing.py），免去下载。
- **Subtitles 组件**：keyword-pop 全片上限 **3** 次，同一词跨句重复出现会累计计数超阈值报错 → 关键词须去重且不跨句重叠。
- 新闻取数走 `producer/scripts/daily-research.ts --date <today> --stream ai-news --edition morning` + `score-and-rank.ts` → `runs/<date>/ai-news-morning/research/`。
