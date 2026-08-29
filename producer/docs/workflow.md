# 共享工作流（三技能公共底座）

> 被三个技能引用：vido-ai-news / vido-open-source / vido-own-project
> 修改本文档会同时影响三个技能的流程。

## 一、数据契约（src/data/types.ts）

today.json 是单活跃项目配置（切换选题即覆盖；渲染产物不受影响）：

```ts
VideoConfig = {
  type: "ai-news" | "open-source" | "own-project" | "recording",
  engine: "hyperframes" | "remotion",   // 渲染引擎路由
  template: "news-slideshow" | "project-spotlight" | "default",
  style: "minimal-tech" | "whiteboard" | "sticky-notes" | "newspaper" | "journal",
  title, subtitle, chapters, blocks[], character, footer
}
VideoBlock = {
  type: "title"|"text"|"code"|"image"|"video"|"terminal"|"chart"|"list"|"hand-drawing",
  content, effect?, svgPath?, items?,
  summary?,   // 详细摘要 2-4 句（文字信息主体，必须）
  points?,    // 要点列表 3-5 条（卡片内模块化展示）
  stats?,     // 数据卡模块 [{label, value}]（关键数字可视化）
  desc?,      // 一句话定位（钩子页副标题）
  narration?, // 旁白文案（TTS+字幕源，辅助，不承载关键信息）
  source?, url?, highlight?,  // 新闻/项目真实数据
  section?  // 内容分区标记
}
```

**文字是信息主体（强制规则）**：重要的、必要的、细节的信息必须用文字展示在画面上；
旁白只是辅助，观众静音也能看懂。每条 block 必须含 summary（详细摘要），
信息密集场景用 points + stats 模块化呈现。禁止只有标题没有正文的页面。

**内容真实化强制规则**：每条 block 必须含真实数据（项目名/star 数/金额/版本号/真实 URL）。
禁止"AI 生态持续爆发"类空话。写 narration 前先深抓原文/README/GitHub API。

## 二、Timeline Manifest（out/timeline.json，唯一时间事实源）

生成：`npm run timeline`（prepare-audio.ts，ffprobe 逐段读 wav 时长）
消费（四处同源，杜绝错位）：
- Remotion：Root.tsx 读 totalFrames 定合成时长；VidoShort/VidoLong 的 Sequence 用 targetFrames + 挂 Audio
- HyperFrames：gen-hyperframes.ts 把 targetFrames/fps 换算成 data-start/data-duration
- gen-srt.ts：字幕时间轴
- proof frames：抽帧审查时间戳（proofTimestamps）

字段：entries[]{blockIndex, audioPath, audioDurationSec, targetFrames, globalStartFrame, globalStartSec, proofTimestamps}

## 三、TTS 旁白（scripts/tts-cosyvoice.py）

双后端：CosyVoice2（HTTP API，环境变量 COSYVOICE_API_URL，如 http://localhost:9880，POST /tts {text, ref_audio}）
→ edge-tts 暂代（zh-CN-YunxiNeural 男声，环境变量 TTS_VOICE 可换）。

```bash
npm run tts        # 读 today.json 的 blocks[].narration → out/voiceover/{i}.wav
```

注意：edge-tts 偶发 "No audio was received"（服务端间歇拒绝），脚本已内置 3 次重试；
仍失败时用补跑脚本模式（重试 8 次间隔 3s，见技能 reference）。

CosyVoice2 就绪后：设置环境变量即可无缝切换（脚本自动优先 CosyVoice2）。

## 四、调研管线（M2，AI 新闻技能主用，项目技能可复用）

```bash
npm run research   # 15 信源采集（AI 10 源+其他新闻 5 源）→ research/today/raw.json + 每日归档
npm run score      # ai-pulse 打分模型（热度0.4/时效0.3/来源0.3）+ 去重 → top.md 双 Top3 推荐卡
```

- 单源失败自动降级；全部失败出回顾版（research/archive/ 最近 3 天）
- AI 审核：读 Top 10 判视频化价值（画面素材/受众相关/真实数据），淘汰空话条目
- 海外源（BBC 等）可能被墙：国内源优先，agent-reach AI 路兜底

## 五、渲染命令

```bash
# AI 新闻（HyperFrames 引擎）
node scripts/gen-hyperframes.ts   # today.json + timeline.json → hyperframes/ai-news/index.html
cd hyperframes/ai-news
npx hyperframes lint              # 0 errors 必须
npx hyperframes snapshot --at 2,10,25,45,65,75   # 抽帧审查
npx hyperframes render --output ../../out/ai_news_short.mp4

# 项目科普/默认（Remotion 引擎）
npm run render:all                # VidoShort + VidoLong 双格式 → out/video_short.mp4 / video_long.mp4
```

## 六、字幕与烧录

```bash
npm run srt             # timeline.json → out/subtitle.srt（B站外挂 & 烧录源）
npm run render:burned   # ffmpeg 烧录字幕版（抖音/小红书用）
```

## 六-B、BGM 铺底与旁白闪避（ducking）

1. BGM 素材放 `public/bgm/bgm.mp3`（或任意路径），today.json 加 `"bgm": "bgm/bgm.mp3"`
2. 双引擎自动生效：
   - Remotion：VidoShort/VidoLong 挂 BgmAudio 组件（帧驱动 volume 回调：旁白段 0.15、间奏 0.5、边界 0.35s 线性过渡）
   - HyperFrames：gen-hyperframes.ts 生成 `<audio id="bgm">` + GSAP `tl.to("#bgm", {volume})` 关键帧（规则一致）
3. 验证：ffmpeg 带通滤波（BGM 基频 220Hz）对比旁白段 vs 间奏段响度，差值 ≈6dB 即 ducking 生效

## 六-C、AI 新闻双风格主题（claude / dark）

AI 新闻只保留两种视觉风格，today.json 的 `style` 字段控制（`claude` 或 `dark`），
gen-hyperframes.ts 也可用 `--style dark` 强制覆盖：

| 风格 | 背景 | 文字 | 强调色 | 适用 |
|---|---|---|---|---|
| `claude` | 暖米白 #FAF9F5 | 墨色 #292524 | 橙棕 #D97757 | 默认，文字优先有设计感 |
| `dark` | 近黑 #0E0E10 | 亮灰 #EDEDEF | 青绿 #34D399 | 暗色高对比主题 |

设计规范：白卡片变暖米白（去纯白）、强调色用主题 accent（禁用蓝色 #007AFF）、
信息密度优先（留白收紧，padding 40/30，字号紧凑）。

## 六-D、5 风格视觉验证（Remotion 侧）

```bash
node scripts/style-check.ts   # 每风格渲染一帧 → out/styles/<style>.png × 5
```

## 六-E、整视频理解（agy gemini-3.7-flash，替代单帧抽查）

成片终审与搬运合规预审都用**完整视频理解**：本机 agy CLI（Antigravity，Google Gemini 的终端 Agent）`--print` 模式直接 `@视频文件` 引用，Gemini 原生多模态完整观看（服务端 1fps 采样 + 时间轴原生对齐），无需本地拆帧。

```bash
# 成片终审（默认 high 档）：核对数据快照/文字溢出/动画冻结/黑帧/时序错位
npm run review:video -- out/ai_news_short.mp4 --kind render --effort high --config src/data/today.json --timeline out/timeline.json
# 搬运合规预审（low 档）：版权素材/敏感内容/违规词 + 摘要/领域
npm run review:video -- repost/inbox/<id>/<视频> --kind repost --effort low
```

- 输出：`out/review-report.json` 或 `repost/inbox/<id>/review-report.json`（verdict pass/warning/fail + issues 带时间戳）
- `verdict=fail` 退出码 1（流程闸口）；模型链：high→medium→low 三档，429 限流自动降档重试
- 报告经 dashboard-add 的 `--review` 参数挂到预览台卡片（徽章 + 问题时间戳可点击跳转）
- 限制：1fps 采样对高速运动可能丢细节（我们的幻灯片式成片无此问题）；单请求一个视频

## 七、强审查清单（渲染后必做：快筛 + 整视频终审）

1. `npx tsc --noEmit` 0 错误（Remotion 侧）；hyperframes lint 0 errors（HyperFrames 侧）
2. 快筛：渲染后用 timeline.json 的 proofTimestamps 抽帧（ffmpeg -ss T -i xxx.mp4 -frames:v 1）拼贴 contact sheet，看文字溢出/空白帧等明显问题
3. **整视频终审（必做）**：`npm run review:video -- <成片> --kind render --effort high [--config ...] [--timeline ...]`，gemini-3.7-flash 完整观看，核对：
   - 关键数字与 today.json 数据快照一致（star 数/百分比/金额）
   - 文字溢出/截断/换行错误/乱码
   - 动画完整（入场到位、无中途冻结）、无黑帧/白帧/花屏
   - 时序对照：画面与 timeline 段落表不错位
   - 旁白与画面同步（成片 duration ≈ timeline totalDurationSec）
4. verdict=fail → 外科手术式修复（只改出错 block，时间轴不动）→ 重渲 → 重新 review
5. 全部通过才算完成；发布需用户明确同意

## 八、发布（草稿闸口，默认停在草稿）

**所有发布默认停在草稿态**（`--draft-mode` 默认开启）：tencent 真草稿箱；其他平台自动取 `now + 平台安全上限` 作为定时时间（纯当草稿箱用），人工在各平台后台改"立即发布"才真正发出。详见 [docs/publish.md](publish.md) 五-B 草稿模式。

```bash
npm run accounts -- --quick               # 账号矩阵与 Cookie 有效性
npm run publish -- --platform bilibili,douyin,xiaohongshu   # 默认草稿闸口
npm run publish -- --platform douyin --no-draft-mode        # 立即发布（仅人工明确要求）
```

B站=横屏+外挂字幕；抖音/小红书=竖屏烧录版。首次登录：`npm run login -- --platform douyin --headed`（抖音/小红书必须 --headed 弹窗扫码，无头会被风控）；多账号：`--accounts a,b,c`。

## 九、预览台（内容审阅闸口）

本地内容台账：三类工作流（日报早/晚场、GitHub 项目、搬运）渲染完成后登记，人工在此审阅、批准、跟踪发布状态。

```bash
npm run dashboard            # 启动 → http://localhost:4399（固定入口）
npm run dashboard:add -- --type ai-news --edition morning --video out/morning/ai_news_short.mp4 --title "..." --accounts "douyin:creator"
```

- 台账：`dashboard/registry.json`（工作数据，不入 git）
- 卡片状态：待审 → 已批准 → 已发草稿 → 已发布（或拒绝）；页面按钮直接切换
- 到期巡检：草稿距定时时间 <7 天自动置"即将到期"警告（server 每小时扫）
- 视频由 server 流式映射 `out/`、`repost/` 目录（支持拖动播放，不复制文件）

三个技能流程末尾都含"登记预览台 → 停在草稿"步骤；实际发布动作仍在对话中人工确认后执行 `npm run publish`。

## 十、三类工作流总览与定时编排

| 时间 | 工作流 | 说明 |
|---|---|---|
| 08:00 | 早场日报 | vido-ai-news --edition morning（窗口 昨08:00→今08:00） |
| 17:30 | 晚场日报 | vido-ai-news --edition evening（窗口 今06:00→17:30） |
| 12:00 | GitHub 项目 | vido-open-source（trending 选题） |
| 10:30/14:30/20:30 | 搬运加工轮 | vido-repost（巡检 inbox → 包装 → 草稿上传） |
| schtasks 每 2h | 搬运采集层 | scripts/repost-download.ts（无 AI，08:00-22:00） |

- 定时任务经 schedule MCP 注册（依赖 Qoder 运行）；漏场可手动补跑，`out/.stage.json` 断点保证幂等（`node scripts/stage.ts next <key> ...`）
- 搬运双层架构：采集层 schtasks 全自动（不依赖 AI/Qoder），加工层 AI 会话每天三轮，inbox 缓冲队列解耦

## 十一、双机传输（Windows 生产 + Mac 自有视频）

分工：Windows = 全部生产 + 搬运发布（账号 Cookie 全在 Windows）；Mac = 自有视频制作与发布。Mac 白天可能带出，需支持离线增量同步。

| 方案 | 机制 | 适用 |
|---|---|---|
| ① Syncthing（主力） | 两机装 Syncthing 共享 `motion-sync/`；Windows 侧成品进 `out/mac-handoff/`，Mac 回家联网即增量同步；轻量数据（registry/accounts/代码）双向 | 不要求同时在线，Mac 白天在外不影响 |
| ② SMB 直连 | Windows 开共享文件夹，Mac 在家时 Finder 连 `smb://192.168.1.x/vido` | 在家即时手动取大文件 |
| ③ Git 同步层 | 代码/配置/registry 走 push/pull（仓库 37chengshan/motion），公网可达 | Mac 白天在外同步代码与轻量数据；视频不入 git |
| ④ 网盘/QQ 中转 | 手动 ZIP 上传 | 应急兜底 |

落地：③+① 为主（代码走 git、视频走 Syncthing），② 作在家即时补充；路由器 192.168.1.1:8080 仅管理界面不参与方案。

Syncthing 配置要点：两机首次配对需同时在线一次（设备 ID 互认）；Windows 侧共享文件夹设"发送+接收"（registry/accounts 双向）或"仅发送"（out/mac-handoff 单向）；Mac 白天在外产生的数据回家后自动双向合并，冲突以最近修改时间为准。

## 十二、账号管理

- 事实源：`data/accounts.json`（平台/账号/领域/用途/状态）；主创号与搬运号严格分离
- 矩阵查询：`npm run accounts`（逐号 sau check 验证 Cookie）；`--quick` 只看本地
- 登录：`npm run login -- --platform <平台> --account <账号> --headed`；批量 `--accounts a,b,c` 逐个弹窗扫码
- 注册准备（人工环节）：`node scripts/account-register-prep.ts --platform douyin --account tech01 --domain 数码` → 独立 Chrome profile（tools/profiles/）+ 注册核对单（data/register-checklists/）+ 台账 paused 条目
- 风控基线：单日单 IP 注册 ≤2 个；新号养号 3-7 天再接自动化；同账号每日 ≤3 条；连续上传失败 ≥2 次自动停用
- Cookie 失效：account-list 标红 → 重新 `npm run login --headed`
