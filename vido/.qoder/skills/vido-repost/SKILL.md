---
name: vido-repost
description: 视频搬运流水线（AI 加工层）——巡检 inbox 缓冲队列，逐条包装（中文标题/标签/meta 合规标注）→ 按领域路由账号 → 草稿上传 → 登记预览台。采集层（scripts/repost-download.ts + schtasks）已自动下载，本技能只做有 AI 的部分。当用户要"搬运视频/搬运流水线/处理搬运队列"或定时任务触发 vido-repost 时使用。
---

# Vido 视频搬运（AI 加工层）

双层架构：**采集层无 AI 全自动**（schtasks 每 2 小时跑 `scripts/repost-download.ts`，下载到 `repost/inbox/<videoId>/`）；**本技能是加工层**（AI 会话，每天 10:30 / 14:30 / 20:30 三轮回）。inbox 是缓冲队列：会话漏跑不丢内容，下轮补处理。

## 完整流程

### 1. 巡检 inbox（先看有没有活）

```bash
Get-ChildItem repost\inbox -Directory   # 待加工条目
node scripts/repost-download.ts --dry-run  # （可选）确认采集层无新候选积压
```

每轮最多处理 **5 条**（超出留到下轮）；每条处理前检查 `repost/history.json` 中该 videoId 状态（inbox=待处理 / processed=已处理 / rejected=已拒绝）。

### 2. 逐条包装（核心：真实信息 + 合规标注）

对每条 `repost/inbox/<videoId>/`：

1. **读源信息**：`<videoId>.info.json`（标题/作者/频道/描述/时长/上传日期）+ 字幕 srt（有则读内容判断主题）
2. **AI 生成中文标题/标签**：基于原始标题与字幕内容翻译+本地化改写（禁止标题党；保留关键数字/名词）
3. **合规预审**（AI 检查）：敏感内容 / 侵权风险（原创音乐、影视片段、新闻素材）/ 平台违规词；有风险标记 rejected 并在 history 注明原因
4. **写 meta.json**（`repost/inbox/<videoId>/meta.json`，发布脚本 --meta 读取）：

```json
{
  "title": "<中文标题>",
  "tags": ["<标签1>", "<标签2>", "<标签3>"],
  "desc": "<中文简介（含源信息）>",
  "declaration": "<抖音转载声明文案，如：视频来自 YouTube 博主 xxx，已注明出处，仅供分享>",
  "cover": "repost/inbox/<videoId>/<缩略图>.jpg",
  "sourceUrl": "<原始视频链接>",
  "author": "<原作者名>",
  "platform": "youtube"
}
```

**版权规则（强制）**：meta.json 必须含 sourceUrl + author；标题/简介标注"来源/原作者"；抖音发布必带 `--declaration` 转载声明；不确定版权（明显非 CC/官方频道、含版权音乐）直接 rejected。仅限个人分发用途，人工审阅闸口兜底。

### 3. 账号路由

读 `data/accounts.json`，按 `domain` 匹配：视频领域 → 账号 domains 含该领域的 repost 号；同一账号当日处理 ≤3 条（查 history.json 今日 processed 计数）；无匹配账号时跳过并告警（等账号体系就绪）。

### 4. 草稿上传（禁止自动发布）

```bash
# 竖屏/横屏按视频比例选；目标平台按路由结果
npm run publish -- --platform douyin --account <账号> --draft-mode --meta repost/inbox/<videoId>/meta.json
# 多平台：--platform douyin,xiaohongshu --account <账号1>,<账号2>
```

封面：默认用下载缩略图（meta.cover）；无缩略图时 ffmpeg 抽首帧：
`ffmpeg -i <video>.mp4 -ss 1 -frames:v 1 cover.jpg`
需要烧字幕时：`ffmpeg -i <video>.mp4 -vf "subtitles=<srt>:force_style='FontSize=24,PrimaryColour=&HFFFFFF&,Outline=2'" -c:a copy <video>_burned.mp4` 后发布烧录版。

### 5. 登记预览台 + 更新 history

```bash
node scripts/dashboard-add.ts --type repost --video repost/inbox/<videoId>/<成品视频> --title "<中文标题>" --accounts "<平台>:<账号>"
```

更新 `repost/history.json` 该条目 status=processed（上传失败保持 inbox 下轮重试；合规拒绝标 rejected）。登记后通知用户打开 http://localhost:4399 审阅；**禁止自动点发布**。

## 时间与节奏

| 项 | 约定 |
|---|---|
| 采集 | schtasks 08:00-22:00 每 2h（无 AI） |
| 加工 | schedule MCP 10:30 / 14:30 / 20:30 |
| 每轮上限 | 5 条 |
| 每账号每日 | ≤3 条 |
| 时长/清晰度 | 采集层已过滤（<15min，≤1080p） |

## 常见问题

- 采集层没下载东西：源无新视频 / 代理端口变了（改 repost/config.json）/ yt-dlp 未装
- 下载失败：多为网络，下轮自动重试（history 未写入）
- 字幕没有：部分视频无字幕，可跳过烧录或用 info.json description 判断主题
- 同一视频多渠道重复：history.json 按 videoId 去重，天然防重
