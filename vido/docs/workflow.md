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

## 七、强审查清单（渲染后必做，proof frames 模式）

1. `npx tsc --noEmit` 0 错误（Remotion 侧）；hyperframes lint 0 errors（HyperFrames 侧）
2. 渲染后用 timeline.json 的 proofTimestamps 抽帧（ffmpeg -ss T -i xxx.mp4 -frames:v 1）
3. 拼贴 contact sheet（ffmpeg xstack 3x2）后 AI 审查：
   - 文字溢出/截断/换行错误
   - 动画完整（入场到位、无中途冻结）
   - 关键数字正确（star 数/百分比与调研数据一致）
   - 无空白帧/黑帧/意外内容
   - 旁白与画面同步（成片 duration ≈ timeline totalDurationSec）
4. 不合格 → 外科手术式修复（只改出错 block，时间轴不动）→ 重渲 → 重审
5. 全部通过才算完成；发布需用户明确同意

## 八、发布（用户确认后）

```bash
npm run login:check -- --platform bilibili   # Cookie 有效性
npm run publish -- --platform bilibili,douyin,xiaohongshu
```

B站=横屏+外挂字幕；抖音/小红书=竖屏烧录版。首次登录：`npm run login -- --platform douyin --headed`（抖音/小红书必须 --headed 弹窗扫码，无头会被风控）。
