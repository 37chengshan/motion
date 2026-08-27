# Remotion 每日视频工作流方案

## 一、调研结果：Remotion 技能模板与社区资源

### 1.1 官方 Agent Skills（remotion-dev/skills）

安装命令：`npx skills add remotion-dev/skills`

| Skill | 用途 |
|-------|------|
| `/remotion-best-practices` | 汇总开发规范（包含所有子 skill） |
| `/remotion-create` | 创建项目或 Composition |
| `/remotion-markup` | 布局、动画、文字、音频、媒体代码最佳实践 |
| `/remotion-studio` | 启动可视化预览 |
| `/remotion-render` | 渲染视频或静态图片 |
| `/remotion-maps` | 地图、路线、地理动画 |
| `/remotion-captions` | 字幕与 Caption 处理 |
| `/remotion-saas` | 视频生成类产品架构设计 |
| `/remotion-interactivity` | Studio 中元素可编辑 |
| `/remotion-docs` | 查询官方文档 |
| `/remotion-upgrade` | 升级 Remotion 及 Skills |
| `/remotion-multimedia` | 视频/音频元数据处理 |

### 1.2 官方模板（35+ 个）

**免费模板（与本项目相关的加粗）：**

| 模板 | 说明 | 适用场景 |
|------|------|----------|
| **Blank** | 空白画布 | 从零构建 |
| **Hello World** | 简单动画 playground | 学习入门 |
| **Next.js** | SaaS 视频生成应用 | 构建视频 SaaS |
| **Prompt to Video** | 从提示词生成带图片+配音的故事视频 | **AI 项目介绍视频** |
| **Prompt to Motion Graphics** | AI 驱动的动画生成 | **动态图形** |
| **Audiogram** | 播客音频可视化 | 音频内容 |
| **TikTok** | 逐词字幕动画 | **竖屏短视频** |
| **Code Hike** | 代码动画 | **开源项目代码展示** |
| **Stargazer** | 庆祝 repo stars | **开源项目介绍** |
| **3D** | React Three Fiber | 3D 效果 |
| **Overlay** | 视频编辑叠加层 | 后期叠加 |
| **Stills** | 动态 PNG/JPEG | 封面图 |
| **Recorder** | JS 录制工具 | 录屏 |

### 1.3 社区关键技能包

#### video-shotcraft（2.2K Stars，Apache 2.0）
- **地址**：https://github.com/Vincentwei1021/video-shotcraft
- **安装**：`npx skills add Vincentwei1021/video-shotcraft`
- **核心能力**：106 张镜头配方卡 + 161 段动态样片 + 完整 Ink Press 模板
- **适用**：电影感产品宣传片，2.5D 运镜、节奏卡点、声音设计
- **三种模式**：模板复用 / 自主创作 / 共同创作

#### OpenMontage
- 开源智能体视频生产系统
- 支持 Remotion + HyperFrames 双引擎
- 内置风格手册（Clean Professional / Flat Motion Graphics / Minimalist Diagram）

### 1.4 推荐技术栈组合

```
核心框架：Remotion 4.x + React 19
样式方案：Tailwind CSS 4
动画引擎：spring() + interpolate() + remotion 内置
字幕方案：@remotion/captions + TikTok 模板
3D 效果：@remotion/three（可选）
云端渲染：AWS Lambda / 本地批量渲染
AI 辅助：remotion-dev/skills + video-shotcraft
```

---

## 二、两种独特视频风格方案

### 风格 A：「蓝图Blueprint」—— 技术解构风

**设计理念**：模拟工程蓝图/技术图纸的视觉语言，传达"拆解技术、深度理解"的定位。
**去 AI 味关键**：手工质感纹理 + 非对称排版 + 不规则动画节奏。

| 维度 | 规范 |
|------|------|
| **配色** | 深蓝底 `#0A1628` + 白色线条 `#E8EDF5` + 荧光橙强调 `#FF6B35` + 淡蓝辅助 `#4ECDC4` |
| **字体** | 标题：Space Grotesk（几何感）/ 正文：IBM Plex Mono（技术感）/ 中文：思源黑体 |
| **纹理** | 网格背景（20px 间距）、微噪点叠加、手绘箭头/圆圈标注 |
| **动效** | 线条描绘动画（stroke-dashoffset）、蓝图展开折叠、等距投影 3D 旋转 |
| **排版** | 非对称网格、元素带标注线和尺寸标记、"爆炸图"式拆解布局 |
| **转场** | 蓝图翻页、墨水晕染展开、电路连线过渡 |
| **音效** | 铅笔划线声、纸张翻动、机械咔嗒、电子蜂鸣点缀 |
| **适用** | 开源 AI 项目介绍（技术架构拆解）、自家项目功能展示 |

**竖屏适配（9:16）**：
- 单列纵向布局，标注线改为侧边
- 字体放大 1.5x，保留蓝图网格
- 时长 30-60 秒，快节奏

**横屏适配（16:9）**：
- 双栏/三栏布局，充分展示架构图
- 时长 3-8 分钟，深度讲解
- 可加入代码动画（Code Hike 风格）

### 风格 B：「剪贴簿Scrapbook」—— 人文叙事风

**设计理念**：模拟手工剪贴簿/杂志拼贴的质感，传达"精心策展、有温度"的调性。
**去 AI 味关键**：不规则裁切 + 实物纹理 + 手写元素 + 不完美的对齐。

| 维度 | 规范 |
|------|------|
| **配色** | 米白底 `#F5F0E8` + 深棕文字 `#2C1810` + 复古红 `#C44536` + 墨绿 `#3D5A3E` + 芥末黄 `#D4A843` |
| **字体** | 标题：Playfair Display（衬线优雅）/ 正文：Source Serif 4 / 中文：思源宋体 / 手写：Caveat |
| **纹理** | 纸张纹理、胶带条、邮票边缘、咖啡渍、报纸印刷网点 |
| **动效** | 纸片飘落堆叠、手写字逐笔出现、印章盖下弹跳、照片从信封滑出 |
| **排版** | 倾斜卡片叠加、撕纸边缘、手写箭头连接、便签条标注 |
| **转场** | 翻页、纸团展开、胶带粘贴、抽屉推拉 |
| **音效** | 纸张沙沙声、剪刀裁剪、胶带撕拉、印章声、打字机声 |
| **适用** | 他人项目介绍（故事化叙述）、项目对比评测 |

**竖屏适配（9:16）**：
- 单张卡片居中，前后景堆叠
- 手写文字放大，便签条式信息
- 时长 30-90 秒

**横屏适配（16:9）**：
- 跨页展开式布局，左右对照
- 时长 5-10 分钟，叙事节奏
- 可加入"翻开下一页"的章节过渡

---

## 三、项目结构建议

```
vido/
├── CLAUDE.md                    # AI Agent 协作指南
├── AGENTS.md                    # Agent 通用配置
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── remotion.config.ts           # Remotion 全局配置
├── .env                         # 环境变量（API keys 等）
├── .env.example
│
├── src/
│   ├── Root.tsx                 # 注册所有 Composition
│   ├── index.ts                 # 入口
│   │
│   ├── types/                   # 类型定义
│   │   ├── video.ts             # 视频 props 类型
│   │   └── content.ts           # 内容数据类型
│   │
│   ├── compositions/            # 视频组合（按类型分）
│   │   ├── own-project/         # 自家项目介绍
│   │   │   ├── OwnProjectIntro.tsx
│   │   │   ├── OwnProjectShort.tsx   # 竖屏版
│   │   │   └── OwnProjectLong.tsx    # 横屏版
│   │   ├── other-project/       # 他人项目介绍
│   │   │   ├── OtherProjectReview.tsx
│   │   │   ├── OtherProjectShort.tsx
│   │   │   └── OtherProjectLong.tsx
│   │   └── open-source/         # 开源 AI 项目介绍
│   │       ├── OpenSourceIntro.tsx
│   │       ├── OpenSourceShort.tsx
│   │       └── OpenSourceLong.tsx
│   │
│   ├── styles/                  # 风格系统
│   │   ├── blueprint/           # 风格 A：蓝图
│   │   │   ├── BlueprintTheme.ts      # 颜色、字体、间距常量
│   │   │   ├── BlueprintBackground.tsx # 网格背景组件
│   │   │   ├── BlueprintTitle.tsx      # 标题组件
│   │   │   ├── BlueprintAnnotation.tsx # 标注线/箭头组件
│   │   │   ├── BlueprintTransition.tsx # 转场组件
│   │   │   └── index.ts
│   │   ├── scrapbook/           # 风格 B：剪贴簿
│   │   │   ├── ScrapbookTheme.ts
│   │   │   ├── ScrapbookBackground.tsx
│   │   │   ├── ScrapbookCard.tsx
│   │   │   ├── ScrapbookHandwrite.tsx
│   │   │   ├── ScrapbookTransition.tsx
│   │   │   └── index.ts
│   │   └── shared/              # 共享样式工具
│   │       ├── transitions.ts
│   │       └── animations.ts
│   │
│   ├── components/              # 通用组件
│   │   ├── layout/
│   │   │   ├── SafeArea.tsx     # 安全区域（竖屏/横屏适配）
│   │   │   ├── Grid.tsx
│   │   │   └── Spacer.tsx
│   │   ├── animation/
│   │   │   ├── LineDraw.tsx     # 线条描绘动画
│   │   │   ├── PaperDrop.tsx    # 纸片飘落
│   │   │   ├── StampEffect.tsx  # 印章效果
│   │   │   ├── Typewriter.tsx   # 打字机效果
│   │   │   ├── Counter.tsx      # 数字滚动
│   │   │   └── FadeSlide.tsx    # 淡入滑动
│   │   ├── media/
│   │   │   ├── Screenshot.tsx   # 项目截图展示
│   │   │   ├── CodeBlock.tsx    # 代码展示（Code Hike 风格）
│   │   │   ├── Logo.tsx         # Logo 展示
│   │   │   └── Avatar.tsx       # 项目/作者头像
│   │   ├── text/
│   │   │   ├── Title.tsx        # 主标题
│   │   │   ├── Subtitle.tsx
│   │   │   ├── Caption.tsx      # 字幕
│   │   │   └── Label.tsx        # 标签/标注
│   │   └── audio/
│   │       ├── BGM.tsx          # 背景音乐
│   │       └── SFX.tsx          # 音效触发器
│   │
│   ├── hooks/                   # 自定义 Hooks
│   │   ├── useVideoProgress.ts  # 视频进度
│   │   ├── useBeat.ts           # 节拍同步
│   │   └── useResponsive.ts     # 竖屏/横屏适配
│   │
│   ├── utils/                   # 工具函数
│   │   ├── timing.ts            # 时间计算
│   │   ├── colors.ts            # 颜色工具
│   │   └── layout.ts            # 布局计算
│   │
│   └── data/                    # 数据层（每日视频内容）
│       ├── projects.json        # 项目数据库
│       └── scripts/             # 脚本/文案
│           └── today.json       # 当日视频脚本数据
│
├── public/                      # 静态资源
│   ├── fonts/                   # 自定义字体
│   ├── audio/
│   │   ├── bgm/                 # 背景音乐
│   │   └── sfx/                 # 音效
│   ├── textures/                # 纹理贴图
│   │   ├── paper.png
│   │   ├── grid.png
│   │   ├── noise.png
│   │   └── tape.png
│   └── images/                  # 图片资源
│
├── scripts/                     # 自动化脚本
│   ├── generate-daily.ts        # 每日视频生成入口
│   ├── fetch-project-info.ts    # 抓取项目信息
│   ├── generate-script.ts       # 生成视频脚本/文案
│   ├── render-batch.ts          # 批量渲染
│   ├── render-config.ts         # 渲染配置
│   └── upload.ts                # 上传到平台（可选）
│
├── output/                      # 渲染输出目录
│   ├── short/                   # 竖屏短视频
│   └── long/                    # 横屏长视频
│
└── docs/                        # 文档
    ├── STYLE_GUIDE.md           # 风格指南详细说明
    └── WORKFLOW.md              # 工作流说明
```

---

## 四、自动化脚本示例

### 4.1 每日视频生成入口 `scripts/generate-daily.ts`

```typescript
import { renderMedia, getCompositions } from "@remotion/renderer";
import { bundle } from "@remotion/bundler";
import path from "path";
import fs from "fs";
import type { VideoScript } from "../src/types/video";

// 渲染配置预设
const PRESETS = {
  // 竖屏 - 抖音/小红书
  short: {
    width: 1080,
    height: 1920,
    fps: 30,
    durationRange: { min: 30, max: 90 }, // 秒
    codec: "h264" as const,
  },
  // 横屏 - B站
  long: {
    width: 1920,
    height: 1080,
    fps: 30,
    durationRange: { min: 180, max: 600 }, // 秒
    codec: "h264" as const,
  },
};

async function generateDailyVideo() {
  const today = new Date().toISOString().split("T")[0];
  console.log(`[生成] ${today} 每日视频`);

  // 1. 读取当日脚本数据
  const scriptPath = path.join(__dirname, "..", "src", "data", "scripts", "today.json");
  const script: VideoScript = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));

  // 2. 打包 Remotion 项目
  console.log("[打包] 正在 bundle...");
  const bundleLocation = await bundle({
    entryPoint: path.join(__dirname, "..", "src", "index.ts"),
    webpackOverride: (config) => config,
  });

  // 3. 获取所有 Composition
  const compositions = await getCompositions(bundleLocation, {
    inputProps: script,
  });

  // 4. 渲染竖屏版
  const shortComp = compositions.find((c) => c.id === script.compositionId + "Short");
  if (shortComp) {
    const outputPath = path.join(__dirname, "..", "output", "short", `${today}-${script.slug}.mp4`);
    console.log(`[渲染] 竖屏版: ${outputPath}`);
    await renderMedia({
      composition: shortComp,
      serveUrl: bundleLocation,
      codec: PRESETS.short.codec,
      outputLocation: outputPath,
      chromiumOptions: {
        enableMultiProcessOnLinux: true,
      },
    });
  }

  // 5. 渲染横屏版
  const longComp = compositions.find((c) => c.id === script.compositionId + "Long");
  if (longComp) {
    const outputPath = path.join(__dirname, "..", "output", "long", `${today}-${script.slug}.mp4`);
    console.log(`[渲染] 横屏版: ${outputPath}`);
    await renderMedia({
      composition: longComp,
      serveUrl: bundleLocation,
      codec: PRESETS.long.codec,
      outputLocation: outputPath,
      chromiumOptions: {
        enableMultiProcessOnLinux: true,
      },
    });
  }

  console.log("[完成] 每日视频渲染完毕");
}

generateDailyVideo().catch(console.error);
```

### 4.2 批量渲染脚本 `scripts/render-batch.ts`

```typescript
import { renderMedia, getCompositions } from "@remotion/renderer";
import { bundle } from "@remotion/bundler";
import path from "path";
import fs from "fs";

interface BatchJob {
  scriptFile: string;
  formats: ("short" | "long")[];
  style: "blueprint" | "scrapbook";
}

const CONCURRENCY = 2; // 同时渲染的任务数
const FRAME_CONCURRENCY = 4; // 每个任务的帧并行数

async function renderBatch(jobs: BatchJob[]) {
  const bundleLocation = await bundle({
    entryPoint: path.join(__dirname, "..", "src", "index.ts"),
  });

  const compositions = await getCompositions(bundleLocation);

  // 分批处理，控制内存
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    const batch = jobs.slice(i, i + CONCURRENCY);
    const promises = batch.map(async (job) => {
      const script = JSON.parse(fs.readFileSync(job.scriptFile, "utf-8"));

      for (const format of job.formats) {
        const compId = `${script.compositionId}${format === "short" ? "Short" : "Long"}`;
        const comp = compositions.find((c) => c.id === compId);
        if (!comp) continue;

        const outputDir = path.join(__dirname, "..", "output", format);
        fs.mkdirSync(outputDir, { recursive: true });

        await renderMedia({
          composition: comp,
          serveUrl: bundleLocation,
          codec: "h264",
          outputLocation: path.join(outputDir, `${script.slug}-${format}.mp4`),
          chromiumOptions: { enableMultiProcessOnLinux: true },
        });
      }
    });

    await Promise.all(promises);
  }
}
```

### 4.3 渲染配置优化 `scripts/render-config.ts`

```typescript
export const renderConfig = {
  // 通用配置
  common: {
    codec: "h264" as const,
    pixelFormat: "yuv420p" as const,
    imageFormat: "jpeg" as const,
    quality: 80,
    crf: 18, // 质量因子（越低质量越高，18-28 推荐）
  },

  // 竖屏配置（抖音/小红书）
  short: {
    width: 1080,
    height: 1920,
    fps: 30,
    videoBitrate: "5M",
    audioBitrate: "128k",
    // 抖音推荐：H.264, AAC, 1080x1920, 30fps
    // 小红书推荐：H.264, AAC, 1080x1920, 30fps
  },

  // 横屏配置（B站）
  long: {
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrate: "8M",
    audioBitrate: "192k",
    // B站推荐：H.264, AAC, 1920x1080, 30fps
    // 高质量可选 60fps + 12M bitrate
  },

  // 性能优化
  performance: {
    // 帧级并行（根据 CPU 核心数调整）
    frameConcurrency: Math.max(1, Math.floor(require("os").cpus().length / 2)),
    // Linux 多进程
    enableMultiProcessOnLinux: true,
    // 超时设置（秒）
    timeout: 600,
    // 每 N 帧打一次日志
    logEveryNFrames: 30,
  },

  // Lambda 云渲染配置（可选）
  lambda: {
    region: "ap-northeast-1" as const, // 亚太区域
    memorySizeInMb: 2048,
    diskSizeInMb: 10240,
    timeoutInSeconds: 900,
    maxRetries: 2,
    // 自动分片渲染
    everyNthFrame: 1,
    framesPerLambda: 30, // 每个 Lambda 处理 30 帧
  },
};
```

---

## 五、渲染配置优化建议

### 5.1 本地渲染优化

| 优化项 | 建议值 | 说明 |
|--------|--------|------|
| `concurrency` | CPU 核心数 / 2 | 帧级并行，避免内存溢出 |
| `crf` | 18-23 | 18 高质量，23 平衡，28 省空间 |
| `codec` | h264 | 兼容性最好；h265 体积小 30% 但兼容性差 |
| `imageFormat` | jpeg | 比 png 快 5-10x，质量 80 足够 |
| `enableMultiProcessOnLinux` | true | Linux 下启用多进程 |
| `chromiumOptions.gl` | "angle-egl" | Windows 下 GPU 加速 |

### 5.2 平台适配参数

**抖音**：
- 分辨率：1080x1920（9:16）
- 编码：H.264 High Profile
- 码率：4-6 Mbps
- 帧率：30fps
- 音频：AAC 128kbps
- 时长：15-60 秒最佳，最长 15 分钟

**小红书**：
- 分辨率：1080x1920（9:16）或 1080x1440（3:4）
- 编码：H.264
- 码率：5-8 Mbps
- 帧率：30fps
- 时长：30-90 秒最佳

**B站**：
- 分辨率：1920x1080（16:9）
- 编码：H.264 High Profile 或 AV1
- 码率：6-10 Mbps（1080p），15-25 Mbps（4K）
- 帧率：30fps 或 60fps
- 音频：AAC 192kbps 或 320kbps
- 时长：3-15 分钟

### 5.3 批量渲染内存管理

```typescript
// 关键：避免一次性加载所有帧到内存
// 1. 使用流式渲染
await renderMedia({
  composition,
  serveUrl: bundleLocation,
  codec: "h264",
  outputLocation: "output.mp4",
  // 控制并行帧数（关键！）
  concurrency: 4,
  // 帧范围分批
  onProgress: ({ progress }) => {
    if (progress % 0.1 < 0.01) {
      global.gc?.(); // 主动触发 GC
    }
  },
});

// 2. 大项目使用 Lambda 分片
// 每个 Lambda 实例只处理 30-60 帧
// 自动并行 + 拼接
```

### 5.4 缓存策略

```typescript
// remotion.config.ts
import { Config } from "@remotion/config";

export default {
  // 启用 Studio 缓存
  staticDir: "./public",
  // 字体预加载（避免每帧重新加载）
  webpackOverride: (config) => ({
    ...config,
    module: {
      ...config.module,
      rules: [
        ...config.module.rules,
        // 字体内联，减少 HTTP 请求
        { test: /\.(woff|woff2|ttf|otf)$/, type: "asset/inline" },
      ],
    },
  }),
};
```

---

## 六、快速启动命令

```bash
# 1. 初始化 Remotion 项目
cd d:\vido
npx create-video@latest . --template blank --tailwind --agent-skills

# 2. 安装官方 Skills
npx skills add remotion-dev/skills

# 3. 安装社区 Skills（推荐）
npx skills add Vincentwei1021/video-shotcraft

# 4. 启动 Studio 预览
npx remotion studio

# 5. 渲染测试
npx remotion render OwnProjectShort output/test-short.mp4
npx remotion render OwnProjectLong output/test-long.mp4
```

---

## 七、每日工作流概览

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌─────────────┐
│  选择项目    │ ──▶ │  填充数据    │ ──▶ │  预览调整    │ ──▶ │  批量渲染   │
│  (JSON数据)  │     │ (today.json) │     │ (Studio)     │     │ (双格式)    │
└─────────────┘     └──────────────┘     └──────────────┘     └──────┬──────┘
                                                                      │
                                                        ┌─────────────┼─────────────┐
                                                        ▼             ▼             ▼
                                                   抖音/小红书      B站          存档
                                                   (竖屏 MP4)    (横屏 MP4)    (源文件)
```
