# 视觉风格规范（6 种）

> 预览：`style-previews/index.html` | 配置：`src/compositions/styles/StyleProvider.tsx`

## 通用机制

- 所有风格实现统一的 `StyleTheme` 接口（background/text/accent/muted/panel/fontFamily/titleFont）
- `StyleProvider` 提供 React Context，任何组件通过 `useStyle()` 获取主题
- 每个风格有对应的 `XxxBackground` 背景装饰组件

## 1. 极简科技 minimal-tech

- 白底 `#ffffff` + 蓝色强调 `#007AFF`（Apple 风）
- 大量留白、细线装饰、顶部渐变光晕
- 字体：system-ui 无衬线
- 适用：AI 新闻日报、科技产品宣传

## 2. 白板笔记 whiteboard

- 点阵背景 + 马克笔粗字体
- 便签纸、手绘箭头元素
- 适用：教学讲解、思路梳理

## 3. 便利贴墙 sticky-notes

- 彩色便签（黄/粉/蓝/紫/绿）+ 胶带固定
- 轻微倾斜角度，活泼氛围
- 适用：清单类、头脑风暴内容

## 4. 报纸头条 newspaper

- 复古报纸排版、双线边框、衬线字体
- 多栏文字布局
- 适用：新闻日报（正式感）

## 5. 手账日记 journal

- 横线信纸 + 红色页边线 + 手写字体
- 胶带贴纸装饰，温暖亲切
- 适用：个人分享、轻量内容

## 6. 深色科技 dark-tech ⭐ 新增（对标 Milvus 天花板）

- 背景 `#0B1220` 深海蓝黑 + 网格 `#1A2332` + 渐变光晕 `radial-gradient(circle at 50% 0%, #1E3A5F 0%, transparent 60%)`
- 强调色 `#22D3EE` 青蓝 + `#A78BFA` 紫，用于标题块、 flowing arrow、脉冲高亮；文字 `#F9FAFB` 近白 + 次级 `#94A3B8`
- 字体：`Inter` 标题粗体 / `JetBrains Mono` 数据标签；标题块圆角 12px、薄阴影 `0 8px 24px rgba(34,211,238,0.12)`、发光描边 `0 0 0 1px rgba(34,211,238,0.25)`
- 点线装饰：1px 网格点阵 `opacity 0.04`、顶部青蓝光带 `height 2px`、卡片内发光边 `box-shadow inset`
- 适用：中间件科普 / 向量数据库 / 数据库 / RAG / 架构课（Milvus/ES/PG/RabbitMQ/Kafka 同款，4K 3840×2160 已验证）
- 运镜绑定：默认 `camera: "kenburns"` + `FlowArrow` 青绿 `#34D399` 流动，卡片 `stagger` 揭示
- 切换：`{ "style": "dark-tech", "camera": "kenburns" }`

> 证据：Milvus 视频 307帧实测，见 `.ccg/tasks/milvus-video-ai-analysis/frames/` 与 `supplement-visual-motion.md`；该视频无白底，全深色科技，5款旧风格无法复刻。

## 切换方式

`src/data/today.json` 中修改 `"style"` 字段：

```json
{ "style": "dark-tech", "camera": "kenburns" }
```

旧风格仍可用：`"style": "newspaper"` 等。

## 新增风格步骤

1. `src/compositions/styles/` 新建 `MyStyle.tsx` 实现 `MyStyleBackground`（`dark-tech` 参考 `DarkTechBackground.tsx` 模板：网格+渐变+光晕）
2. `StyleProvider.tsx` 的 `styleThemes` 添加主题色：
```ts
"dark-tech": { background: "#0B1220", text: "#F9FAFB", accent: "#22D3EE", muted: "#1A2332", panel: "#111827", fontFamily: "Inter", titleFont: "Inter" }
```
3. `types.ts` 的 `VideoStyle` 添加 `"dark-tech"`
4. `StyleProvider.tsx` 背景分发处添加 `case "dark-tech": return <DarkTechBackground />`
5. `style-previews/index.html` 新增预览卡
