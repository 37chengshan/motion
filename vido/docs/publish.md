# 多平台发布与字幕策略

> 脚本：`scripts/publish.ts` | 工具：social-auto-upload（10K+ Stars）

## 一、平台矩阵

| 平台 | 格式 | 字幕策略 | 章节支持 |
|------|------|---------|---------|
| B站 | 横屏 1920×1080 | 外挂 SRT | ✅ 章节分栏 API |
| 抖音 | 竖屏 1080×1920 | 烧录内嵌 | ❌ |
| 小红书 | 竖屏 1080×1920 | 烧录内嵌 + 图文封面 | ❌ |
| 快手 | 竖屏 | 烧录内嵌 | ❌ |
| YouTube | 横屏 | 外挂 SRT | ✅ 描述区时间戳 |

## 二、字幕策略

### B站 / YouTube：外挂 SRT

- 渲染时不烧字幕，产出干净版视频 + `out/subtitle.srt`
- B站上传后在创作中心单独上传字幕（支持 SRT/ASS）
- 优点：观众可开关、清晰度无损

### 抖音 / 小红书：FFmpeg 烧录

```bash
ffmpeg -i out/video_short.mp4 \
  -vf "subtitles=out/subtitle.srt:force_style='FontSize=24,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,Outline=2,MarginV=60'" \
  -c:a copy out/video_short_burned.mp4
```

## 三、B站章节分栏

```http
POST https://api.bilibili.com/x/v2/upload/video/chapters/edit
Content-Type: application/x-www-form-urlencoded

cid=<视频cid>&title@<章节名>&start@<秒>&...&csrf=<token>
```

章节数据来自 `today.json` 的 `chapters` 字段（`"00:30"` 格式自动转秒）。

## 四、平台登录（首次使用必做）

登录原理：playwright 打开平台登录页 → 终端/本地二维码 → 手机扫码 → Cookie 自动保存到 `tools/social-auto-upload/cookies/{platform}_{account}.json`。

```bash
# 一次性安装（已完成可跳过）
git clone https://github.com/dreammis/social-auto-upload.git tools/social-auto-upload
cd tools/social-auto-upload
copy conf.example.py conf.py
pip install -r requirements.txt
# requirements.txt 不完整，需补装三个遗漏依赖（否则登录报 ModuleNotFoundError）
pip install opencv-python-headless segno patchright
# 抖音/小红书登录走 patchright，须单独下载其浏览器内核（与 playwright 的不能互用）
python -m playwright install chromium
python -m patchright install chromium
cd ../..

# 扫码登录各平台（账号名默认 creator）
# 抖音/小红书对无头浏览器风控严格，扫码后可能不跳转；务必加 --headed 弹出真实浏览器窗口扫码
npm run login -- --platform bilibili      # B站（终端二维码）
npm run login -- --platform douyin --headed        # 抖音（弹出浏览器窗口）
npm run login -- --platform xiaohongshu --headed   # 小红书（弹出浏览器窗口）
npm run login -- --platform kuaishou --headed      # 快手
npm run login -- --platform tencent --headed       # 视频号
npm run login -- --platform all --headed           # 逐个登录全部（弹窗）
# 批量登录多账号（逐个弹窗扫码，扫完自动下一个）
npm run login -- --platform douyin --accounts tech01,tech02 --headed

# 检查 Cookie 是否有效（发布前自动检查，也可手动）
npm run login:check -- --platform bilibili
npm run accounts -- --quick        # 账号矩阵一览（含领域/用途/Cookie 状态）

> 终端二维码显示不完整时，打开 `tools/social-auto-upload/` 目录下生成的 `qrcode.png` 扫码。
> Cookie 有效期内无需重复登录；失效后重新 `npm run login` 即可。

## 五、发布命令（真实调用）

```bash
npm run publish -- --platform bilibili                 # 发 B站（发布前自动检查登录）
npm run publish -- --platform bilibili,douyin,xiaohongshu
npm run publish -- --platform all --tags "AI,开源,日报"
npm run publish -- --platform douyin --title "自定义标题"
```

发布流程：检查视频文件 → 检查登录（未登录提示先 `npm run login`）→ 调用 `sau_cli.py <平台> upload-video`。

## 五-B、草稿模式（草稿闸口，默认开启）

**所有发布默认停在草稿态**，人工在预览台/后台确认后才真正发出——这是内容审核闸口，不要关闭。

```bash
# 默认行为：草稿闸口（tencent 真草稿箱；其他平台远期定时）
npm run publish -- --platform douyin --account creator
# 显式定时时间（覆盖自动计算的远期时间）
npm run publish -- --platform douyin --schedule "2026-09-01 10:00"
# 立即发布（仅人工明确要求时）
npm run publish -- --platform douyin --no-draft-mode
# 搬运流水线：标题/标签/声明从 meta.json 读取
npm run publish -- --platform douyin --account tech01 --draft-mode --meta repost/xxx/meta.json
```

### 草稿时间策略（DRAFT_HORIZON）

| 平台 | 草稿实现 | 定时上限（天） |
|---|---|---|
| 视频号 tencent | 真 `--draft`（草稿箱，最安全） | — |
| B站 bilibili | `--schedule` 远期定时 | 25 |
| 抖音 douyin | `--schedule` 远期定时 | 9 |
| 小红书 xiaohongshu | `--schedule` 远期定时 | 13 |
| 快手 kuaishou | `--schedule` 远期定时 | 6 |

自动取 `now + 上限` 作为定时时间（远超平台 now+2h 下限，纯当草稿箱用，避免误选近期时间自动发出）。
B站远期定时被拒时自动回退为近期待发（now+2h）并告警。

### 各平台后台把草稿改"立即发布"的操作指引

1. **抖音**：抖音创作服务平台 → 内容管理 → 定时发布（草稿）→ 找到对应视频 → 编辑 → 发布时间改为更早时间或点"立即发布"
2. **小红书**：小红书创作服务平台 → 视频管理 → 定时发布 → 点"立即发布"
3. **快手**：快手创作者平台 → 作品管理 → 定时发布 → 立即发布
4. **B站**：创作中心 → 内容管理 → 稿件管理 → 定时稿件 → 立即发布
5. **视频号**：视频号助手/公众号后台 → 草稿箱 → 发布

> 建议每天用预览台（npm run dashboard）巡检：草稿距定时时间 <7 天会显示"即将到期"警告，及时处理避免过期内容自动发出。

## 六、发布清单

- [ ] 各平台已登录（`npm run login:check -- --platform <平台>`）
- [ ] 渲染双格式完成（out/video_short.mp4 + video_long.mp4）
- [ ] 字幕：SRT 生成 + 烧录版导出（`npm run render:burned`）
- [ ] 封面图（style-previews 导出或首帧截图）
- [ ] `npm run publish -- --platform bilibili,douyin,xiaohongshu`（默认草稿闸口，确认后在各平台后台"立即发布"）
