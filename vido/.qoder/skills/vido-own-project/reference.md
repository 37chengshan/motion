# vido-own-project Reference

## 与 vido-open-source 的差异速查

| 维度 | open-source | own-project |
|---|---|---|
| 数据来源 | GitHub API 深抓 | 用户提供 + 官网抓取 |
| 钩子数字 | stars 滚动 | 版本号/用户量/性能等品牌数字 |
| 收尾 | "去点星" + repo 链接 | CTA（立即体验）+ 官网链接 |
| footer | 数据来源标注 | 品牌名 · 官网 · 口号 |
| character | cat | rocket（可换） |

## MacDesktopFormat（AI 分享格式）要点

组件：src/components/formats/MacDesktopFormat.tsx
- 视觉：macOS 菜单栏 + 红绿灯按钮 + conic-gradient 流动边框（随帧旋转）+ Dock 栏
- 接入：today.json 的 aiSharing 字段（screenRecording/avatarVideo/windowTitle）
- 素材放 public/（Remotion staticFile 引用）
- 详细规范：docs/mac-format.md

## 品牌色定制

1. 快速：today.json 换 style（5 风格主题色见 docs/styles.md）
2. 深定制：src/compositions/styles/StyleProvider.tsx 的 styleThemes 加品牌主题
   （background/text/accent/muted/panel/fontFamily/titleFont 七字段）+ types.ts 加 VideoStyle

## 素材规范

- logo/截图：public/ 目录，PNG 带透明底最佳；image block 的 src 用文件名（staticFile 解析）
- 屏幕录制：mp4，1080p+，时长≤60s（长了渲染慢）
- 数字人：mp4 透明底（或配合 remove-background 处理）

## 审查附加项

- 官网 URL 逐字核对（品牌错误零容忍）
- 卖点数字与用户口述一致
- CTA 在最后 3 秒仍可见（不要被尾帧缓冲吞掉）
