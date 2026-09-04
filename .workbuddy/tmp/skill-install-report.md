# Motion 项目 Skill 安装报告

**日期**：2026-08-29　**目标**：`~/.workbuddy/skills/`　**结果**：29 个项目 skill + 1 个工具 skill，共 99MB，全部校验通过

---

## 一、项目理解

Motion 是**单仓库双运行面 + 公网控制面**的每日视频生产发布系统：

| 目录 | 运行面 | 职责 |
|---|---|---|
| `producer/` | Windows | 研究选题 → 写稿 → TTS → 素材 → HyperFrames/Remotion 渲染 → 整片审查 → Ed25519 签名交接包 |
| `publisher/` | Mac | 只验包 + 发布，**不跑 TTS/FFmpeg/渲染/模型** |
| `cloud/` | Cloud Run | Firestore 索引 + GCS 对象中转，不存 Cookie |
| `contracts/` | 共享契约 | PackageManifest Schema + JCS/Ed25519 三端互验向量 |

内容线：AI 新闻日报、世界新闻日报（各早晚两场，HyperFrames 批量）、每日 GitHub 项目介绍、周末精品/自有项目（Remotion）。

---

## 二、安装清单（29 个）

### A. 上游 remote skill（16 个，来自 8 个 GitHub 仓库，项目内已 copy）

| Skill | 文件 | 体积 | 用途 |
|---|---|---:|---|
| `hyperframes` 相关见 B 组 | | | |
| `video-spec-builder` | 33 | 523KB | 分镜 / storyboard 规格 |
| `watch` | 10 | 106KB | 整片理解与审查（含 Whisper fallback） |
| `srt-vox-director` | 99 | 35.0MB | 字幕驱动配音导演 |
| `srt-whiteboard-animation` | 19 | 12.3MB | 白板动画 |
| `whiteboard-stream-animation` | 11 | 8.7MB | 流式白板动画 |
| `ai-motion-director` | 4 | 11KB | AI 运镜导演 |
| `reference-video-replica-qc` | 12 | 58KB | 参考片复刻质检 |
| `animation-principles` | 5 | 28KB | 动画十二原则 |
| `shot-composition` | 3 | 19KB | 镜头构图 |
| `motion-art-direction` | 3 | 17KB | 动态美术指导 |
| `beat-sync-editing` | 3 | 20KB | 卡点剪辑 |
| `remotion-video` | 3 | 17KB | Remotion 渲染 |
| `gsap-web` | 6 | 34KB | GSAP 动效 |
| `60fps-animation` | 3 | 16KB | 高帧率动画 |
| `svg-animation` | 3 | 18KB | SVG 动画 |
| `lottie-animation` | 3 | 19KB | Lottie 动画 |

### B. 本地上游 HyperFrames 系列（10 个，CLI v0.8.14）

| Skill | 文件 | 体积 |
|---|---:|---:|
| `hyperframes` | 1 | 17KB |
| `hyperframes-core` | 13 | 78KB |
| `hyperframes-animation` | 115 | 38.2MB |
| `hyperframes-keyframes` | 3 | 22KB |
| `hyperframes-creative` | 67 | 1000KB |
| `hyperframes-cli` | 7 | 54KB |
| `hyperframes-audio` | 7 | 96KB |
| `hyperframes-registry` | 10 | 49KB |
| `hyperframes-media` | 40 | 1.4MB |
| `media-use` | 19 | 66KB |

### C. 项目内编排 skill（3 个）

| Skill | 用途 |
|---|---|
| `motion-design` | 镜头 → 动效映射（reveal / data-motion / camera / carousel / none） |
| `video-agency-roles` | 七层顺序质量门（选题→事实→开发者视角→视觉→审美→节奏→平台包装） |
| `motion-media-handoff` | 素材/音频/字幕/时间轴/渲染交接门（**由 `hyperframes-media` 改名**） |

---

## 三、关键发现与处置

**1. 8 个 skill 的 digest 与锁文件不符 —— 不是篡改，是 CLI 升级**
本地 HyperFrames CLI 已从 v0.8.10 升到 **v0.8.14**，上游 skill 文档随之演进。
按你的选择，安装本地最新版（与已装 CLI 配套，避免旧文档驱动新工具），并回写锁文件。

**2. 同名冲突：`hyperframes-media` 有两个完全不同的 skill**
- 官方原子 skill（11.4KB，TTS/BGM/SFX 音频引擎，带 `scripts/audio.mjs`）
- 项目内编排 skill（2.2KB，只讲交接门与渲染校验）

官方版被 `hyperframes-core`/`cli`/`animation` 等 **6 处引用**，故保留原名；项目版改名 `motion-media-handoff`，
已同步修正其 frontmatter 的 `name` 字段（否则会与官方版注册撞名）。

**3. 安全审计：6 处命中全部为误报**
| 命中 | 实际 |
|---|---|
| `media-use/probe.mjs` 的 `rm -rf ~` | 防御性**注释**，解释如何防恶意文件名逃逸 |
| `watch/setup.py` 的 `sudo apt install` | 错误提示文案，不自动执行 |
| `srt-vox-director` 的 `.cn` 链接 | 剪映官网（域名规则误伤） |

唯一需知情项：`media-use` 文档含 `curl ... | bash` 安装 heygen CLI 的建议（官方做法，非自动执行）。

**4. 环境陷阱（已固化为 skill）**
Git Bash heredoc 会把正则里的 `\s` 转成 `/s`（MSYS 路径转换），导致检测全部误报。
含正则的脚本必须用 Write 工具落盘。

---

## 四、变更文件

| 文件 | 变更 |
|---|---|
| `~/.workbuddy/skills/` | 新增 30 个 skill 目录（99MB） |
| `D:/motion/skills.lock.json` | 25 → 29 条；刷新 8 个 digest；补录 4 条；新增 `digest_algorithm` 等元信息 |
| `D:/motion/.workbuddy/tmp/skills.lock.json.bak` | 锁文件备份 |

**未更新**：`source_tree_digest`（CLI 未公开算法，试了 4 种构造均无法复现），已标记
`source_tree_digest_stale: true`，避免猜错污染权威记录。

**校验结果**：30/30 frontmatter 合规；29/29 lock digest 精确匹配。
