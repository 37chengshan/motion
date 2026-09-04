# 常见问题（FAQ）

## Q: npm install 报 404？

`@remotion/maps` 需 Mapbox 授权，已从依赖移除。如需地图动画，参考 Remotion Maps 官方文档申请。

## Q: Remotion Studio 启动报 webpack 配置错误？

确认 `remotion.config.ts` 中 Tailwind 配置：
```ts
import { enableTailwind } from "@remotion/tailwind-v4";
Config.overrideWebpackConfig((config) => enableTailwind(config));
```

## Q: 渲染速度慢？

- 竖屏竖屏 1080×1920 比 1920×1080 慢 ~15%
- 可用 `--concurrency` 提高 Chrome 标签页并行度
- 大量帧内计算（噪声/粒子）考虑 `delayRender` 预生成

## Q: 中文字体在哪里配置？

`StyleProvider.tsx` 的 `styleThemes` 中 `fontFamily` / `titleFont` 字段。推荐用 `@remotion/google-fonts` 加载 Noto Sans SC / ZCOOL KuaiLe（手账风格）。

## Q: 如何新增一种内容块类型？

1. `types.ts` 的 `VideoBlock.type` 联合类型中添加
2. `BlockRenderer.tsx` 添加分发 case
3. 实现 UI 组件放入 `components/effects/`

## Q: GPT-SoVITS API 启动失败？

- 检查显存（需 6G+）
- `api_v2.py` 默认端口 9880，确认防火墙放行
- Windows 下需要安装 CUDA 版 PyTorch

## Q: 抖音/小红书审核烧录字幕？

烧录版由 FFmpeg `subtitles` 滤镜生成，见 `docs/publish.md`。注意 MarginV 留出底部安全区。

## Q: 每日调研数据源失败怎么办？

脚本使用 `Promise.allSettled`，单个源失败不影响整体。日志会输出 `[research] xxx 获取失败，跳过`。
