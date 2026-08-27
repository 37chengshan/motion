# vido-open-source Reference

## GitHub API 技巧

```bash
# 元数据（含 stargazers_count/forks_count/language/license/created_at）
curl -s -H "User-Agent: vido-research" https://api.github.com/repos/<owner>/<repo>
# README 原文（raw）
curl -s -H "User-Agent: vido-research" -H "Accept: application/vnd.github.raw" \
  https://api.github.com/repos/<owner>/<repo>/readme
# releases（版本号/发布时间）
curl -s -H "User-Agent: vido-research" https://api.github.com/repos/<owner>/<repo>/releases?per_page=3
```

- 免登录限频 60 次/小时，够用；401/403 时等一会或用 gh CLI（`gh api repos/<owner>/<repo>`）
- star 数一定用 API 实时值（调研数据可能隔天）
- README 被墙/超时：`curl -s "https://r.jina.ai/https://github.com/<owner>/<repo>"`

## ProjectSpotlight 页面路由（SceneForBlock）

| block | 页面 | 动画 |
|---|---|---|
| type=title | HookPage | StaggerText 标题 + StatCounter 解析 highlight 数字滚动 |
| type=list + section=problem | ProblemPage | ComparisonCard 左右对比 + VS 徽章弹入 |
| type=list（无 section） | FeaturesPage | ListBlock 序号徽章+高亮条 |
| type=hand-drawing | ArchitecturePage | HandDrawing evolvePath 真实绘制顺序+笔尖 |
| type=terminal/code | HandsOnPage | TerminalTypewriter macOS 终端逐行打字 |
| type=chart | StepsPage | ProgressSteps 步骤进度 |
| type=text | OutroPage | 标题 + StatCounter + URL + 来源 |

highlight 数字解析：`"2700 stars"`/`"12.3k"`/`"350万"` → StatCounter 滚动（k→×1000，万→×10000）。

## 效果组件清单（src/components/effects/）

TypewriterEffect / StaggerText（中英混排分词+overshoot）/ BlurText（+位移）/ ListBlock（序号徽章）/
TerminalTypewriter（帧驱动光标）/ CodeBlock / HandDrawing / CharacterProgressBar /
StatCounter / ComparisonCard / ProgressSteps

新组件规范：`useStyle()` 取主题色（theme.accent/text/muted/panel + orientation），动画用
useCurrentFrame+spring/interpolate（确定性），导出 React.FC。

## 音画同步机制（自动）

Root.tsx 启动时读 out/timeline.json（存在则）：
- durationInFrames = totalFrames；fps 用 timeline.fps
- defaultProps 注入 timelineEntries → VidoShort/VidoLong 按 targetFrames 设 Sequence 并挂
  `staticFile("voiceover/N.wav")` Audio（prepare-audio.ts 已把 wav 同步到 public/voiceover/）
- timeline.json 不存在时回退估算时长（75/90 帧每块）——删掉 timeline.json 就是旧行为

## 渲染产物

- out/video_short.mp4（1080×1920）→ 抖音/小红书
- out/video_long.mp4（1920×1080）→ B站
- out/subtitle.srt → B站外挂；`npm run render:burned` 烧录竖屏版
