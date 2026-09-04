# vido-ai-news Reference

## HyperFrames CLI 常用命令

```bash
npx hyperframes lint                              # 静态检查（0 errors 必须）
npx hyperframes validate                          # 运行时校验（控制台错误）
npx hyperframes snapshot --at <t1>,<t2>,…         # 指定时间戳抽帧 → snapshots/
npx hyperframes preview                           # Studio 预览（浏览器交互）
npx hyperframes render --output <path> [--fps 30] # 渲染 MP4
```

## gen-hyperframes.ts 页面路由表

| block 特征 | 页面类型 | 视觉 |
|---|---|---|
| type=title | 开场页 | 大标题+副标题+渐变强调线 |
| type=list | 总评页 | 标题+3 项序号徽章卡片+来源 |
| type=text 且 content ≤8 字含"新闻/速报" | 分区页 | 大字+宽强调线 |
| type=text 且有 url | 新闻卡页 | highlight 徽章+大标题+来源+URL+序号"N/M" |
| 其他 text | 普通文本页 | 居中大字 |

## HyperFrames 契约要点（改 index.html 时遵守）

- root：`data-composition-id="ai-news"` + `data-start="0"` + width/height/duration
- clip：`class="clip"` + `data-start`/`data-duration`/`data-track-index`，root 直接子元素
- audio：root 直接子元素，`src="assets/voiceover/N.wav"`（相对项目目录）
- GSAP：`window.__timelines["ai-news"] = gsap.timeline({ paused: true })`，同步构建
- 确定性：禁 Math.random/Date.now/repeat:-1；动画只用 transform/opacity 系
- 同 track 不重叠（相邻 clip 用 duration-0.01s 留缝）
- lint 的 timeline_track_too_dense：track 已轮流分 3 组（1/2/3），超过 ~15 页需再分组

## 已知坑

- index.html 是生成产物：改 today.json/timeline 后重跑 `node scripts/gen-hyperframes.ts`，勿手改 HTML（会被覆盖）
- snapshots 与 render 都从 index.html + assets/ 读，重生成后 assets/voiceover 同步刷新
- 渲染时长= root data-duration（timeline totalDurationSec），音画对齐由 data-start 同源保证
