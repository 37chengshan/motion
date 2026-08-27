# 视觉风格规范（5 种）

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

## 切换方式

`src/data/today.json` 中修改 `"style"` 字段：

```json
{ "style": "newspaper", ... }
```

## 新增风格步骤

1. `src/compositions/styles/` 新建 `MyStyle.tsx` 实现 `MyStyleBackground`
2. `StyleProvider.tsx` 的 `styleThemes` 添加主题色
3. `types.ts` 的 `VideoStyle` 添加类型
4. `StyleProvider.tsx` 背景分发处添加 case
