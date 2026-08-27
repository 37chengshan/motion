---
name: vido-own-project
description: 制作自有项目宣传视频（Remotion 引擎），复用开源项目科普模板但定制品牌元素（自家 logo/链接/卖点），支持 Mac 桌面分享格式。当用户要"给我自己的项目做宣传视频/产品介绍视频/推广片"、提到 own-project 或自家产品时使用。流程：用户提供项目资料 → 品牌定制组装 → CosyVoice2 旁白 → Remotion 双格式渲染 → proof frames 审查。
---

# Vido 自有项目宣传（Remotion 引擎）

复用 ProjectSpotlight 科普叙事模板（src/components/templates/ProjectSpotlight.tsx），差异：品牌元素定制 + 卖点导向叙事 + 可选 Mac 桌面分享格式（MacDesktopFormat）。双格式：竖屏 + 横屏。

共享底座见 [docs/workflow.md](../../../docs/workflow.md)——先读它。

## 完整流程

### 1. 收集项目资料（向用户要）

必须问（AskUserQuestion 或对话）：
- 项目名 + 一句话定位（subtitle）
- 官网/GitHub/文档链接（url）
- 核心卖点 3 条（features）
- 有无 logo/截图素材（image block 用，放 public/ 下）
- 可选：品牌色（默认用 minimal-tech 蓝 #007AFF；有品牌色时改 today.json style 或在模板里覆盖 accent）

用户只给链接时：`curl -s "https://r.jina.ai/<url>"` 抓官网/README 自行结构化，再向用户确认要点。

### 2. 生成 today.json（品牌定制版）

与 vido-open-source 相同结构（template: "project-spotlight"），差异点：

```json
{
  "type": "own-project", "engine": "remotion", "template": "project-spotlight",
  "style": "minimal-tech",
  "title": "<项目名>",
  "subtitle": "<品牌主张一句话>",
  "character": "rocket",
  "footer": "<项目名> · <官网> · <口号>",
  "blocks": [
    {"type": "title", "content": "<项目名>", "highlight": "<版本号/上线时间等品牌数字>", "section": "features", "narration": "…"},
    {"type": "list", "content": "为什么需要它", "items": ["痛点：…", "<项目名>：…"], "section": "problem", "narration": "…"},
    {"type": "list", "content": "核心卖点", "items": ["…","…","…"], "section": "features", "narration": "…"},
    {"type": "terminal", "content": "$ <安装/使用命令>", "section": "hands-on", "narration": "…"},
    {"type": "text", "content": "立即体验", "highlight": "<品牌数字>", "source": "<项目名>", "url": "<官网>", "section": "outro", "narration": "…"}
  ]
}
```

叙事差异 vs 开源科普：不比 star（比用户量/版本/性能等品牌数据）；收尾是 CTA（立即体验/官网链接）而非"去点星"。

### 3. 可选：Mac 桌面分享格式

做"AI 分享风"视频（屏幕录制+数字人+Mac 窗口包装）时：today.json 加 aiSharing 字段
（screenRecording/avatarVideo/windowTitle），素材放 public/，
渲染时用 MacDesktopFormat 组件（src/components/formats/MacDesktopFormat.tsx，见 docs/mac-format.md）。

### 4. 旁白 + 渲染 + 审查

```bash
# 断点续跑：选题 key 如 own-<project-slug>，重入时跳过已完成阶段
# node scripts/stage.ts next <key> tts,timeline,render,review
npm run tts && npm run timeline && npm run srt
npx tsc --noEmit
npm run render:all
node scripts/stage.ts done <key> render
```

审查（docs/workflow.md 第七节）+ 自有项目特有检查项：
- 品牌名/链接拼写正确（官网 URL 逐字核对）
- 卖点数字与用户提供的一致
- CTA 清晰可见
- **整视频终审（必做）**：`npm run review:video -- out/video_short.mp4 --kind render --effort high --config src/data/today.json --timeline out/timeline.json`，模型完整观看成片核对上述项；verdict=fail → 修复重渲

### 5. 交付与发布

交付 out/video_short.mp4 + video_long.mp4 + subtitle.srt。发布（用户确认后）：
B站横屏+外挂字幕；抖音/小红书竖屏烧录版（npm run render:burned）。

### 6. 登记预览台 → 停在草稿（流程必做）

```bash
node scripts/stage.ts done <key> review
node scripts/dashboard-add.ts --type github --video out/video_short.mp4 --title "<项目名>宣传" --accounts "<平台>:<账号>,..."
```

登记后通知用户打开 http://localhost:4399 审阅；**禁止自动点发布**（`npm run publish` 不传 `--no-draft-mode` 即停在草稿）。

## 常见问题

- 无 logo 素材：纯文字排版（title 页大字+强调线已足够）；有素材放 public/logo.png 用 image block
- 想换品牌色：改 today.json style（5 风格见 docs/styles.md），或深定制改 StyleProvider.tsx 主题色
- 多版本文案：today.<version>.json 备份，切换即覆盖 today.json
