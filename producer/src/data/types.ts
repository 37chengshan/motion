// Vido 视频内容数据类型定义

export type VideoStyle =
  | "minimal-tech" // #1 极简科技
  | "whiteboard" // #3 白板笔记
  | "sticky-notes" // #5 便利贴墙
  | "newspaper" // #6 报纸头条
  | "journal"; // #9 手账日记

export type ContentType =
  | "ai-news" // A. AI 新闻日报（全球 AI 动态，HyperFrames 引擎，早晚双场）
  | "intl-news" // A2. 国际新闻（HyperFrames 引擎）
  | "cn-news" // A3. 国内新闻（HyperFrames 引擎）
  | "ent-news" // A4. 娱乐新闻（国内外，HyperFrames 引擎）
  | "world-news" // 兼容旧值（deprecated）：原世界新闻，已由 intl-news 取代
  | "github-daily" // B1. 每日 GitHub 项目介绍（HyperFrames project-spotlight）
  | "github-weekly" // B2. 每周 GitHub 精品项目（Remotion 定制）
  | "own-project-weekly" // C. 每周自有项目宣传（Remotion 定制）
  | "own-project" // 兼容旧值：自有项目宣传（Remotion 引擎）
  | "open-source" // 兼容旧值：开源项目介绍（Remotion 引擎）
  | "recording"; // D. 真人操作录屏（Remotion 引擎）

/** 渲染引擎：ai-news 用 HyperFrames（HTML 幻灯片），重动画/3D 用 Remotion */
export type RenderEngine = "hyperframes" | "remotion";

/** 视频模板：合成内部按此分支渲染 */
export type VideoTemplate =
  | "news-slideshow" // 新闻幻灯片（总评+双半场）
  | "project-spotlight" // 项目科普（专属动画）
  | "default"; // 现有 Series+BlockRenderer

export type CharacterType =
  | "cat"
  | "dog"
  | "anime-girl"
  | "pixel-hero"
  | "rocket";

export interface VideoChapter {
  start: string; // "00:00" 格式
  title: string;
}

export interface VideoBlock {
  type:
    | "title"
    | "text"
    | "code"
    | "image"
    | "video"
    | "terminal"
    | "chart"
    | "list"
    | "hand-drawing";
  content: string;
  /** 动画效果名，对应 effects 目录组件 */
  effect?: string;
  /** 手绘 SVG path（hand-drawing 类型用） */
  svgPath?: string;
  /** 代码语言（code 类型用） */
  language?: string;
  /** 图片地址（image 类型用） */
  src?: string;
  /** 列表项（list 类型用） */
  items?: string[];
  /** 数据点（chart 类型用） */
  data?: { label: string; value: number }[];
  /** 详细摘要（2-4 句，文字信息主体；旁白是辅助） */
  summary?: string;
  /** 要点列表（3-5 条，卡片内模块化展示） */
  points?: string[];
  /** 数据卡模块（label/value 对，如 [{label:"Stars",value:"2.7k"}]）；数字必须携带来源（§2.7） */
  stats?: {
    label: string;
    value: string;
    /** 该数字的来源 URL（GitHub API / README / 项目官方页） */
    sourceUrl?: string;
    /** 该数字所来源快照的 SHA-256 */
    sourceSnapshotHash?: string;
  }[];
  /** 一句话定位/描述（钩子页副标题） */
  desc?: string;
  /** 旁白文案（TTS 合成与音画同步用，1-2 句口语化） */
  narration?: string;
  /** 新闻来源标识（如 "Hacker News" / "量子位"） */
  source?: string;
  /** 真实链接（新闻原文/项目地址） */
  url?: string;
  /** 原文快照 SHA-256（§2.6：每个事实必须绑定来源快照） */
  sourceSnapshotHash?: string;
  /** 事实列表（每条均绑定本 block 的 url + sourceSnapshotHash） */
  facts?: string[];
  /** 声明（如"AI 摘要整理，以原文为准" / 数据来源声明） */
  disclaimer?: string;
  /** 关键数字/数据点（如 "12.3k stars"，用于画面高亮） */
  highlight?: string;
  /** 内容分区标记：新闻（总评双评+双半场）或科普叙事（problem=有无对比页）
   *  四方向新增 intl-news / cn-news / ent-news（与 StreamId 对应）
   */
  section?:
    | "review-ai"
    | "review-other"
    | "ai-news"
    | "intl-news"
    | "cn-news"
    | "ent-news"
    | "other-news"
    | "problem"
    | "features"
    | "architecture"
    | "hands-on"
    | "outro";
  /** 方向徽章（四方向主题色）：ai-news / intl-news / cn-news / ent-news */
  tag?: string;
  /** 素材图（素材页用）。src 为 run 相对路径，禁止绝对路径 */
  media?: {
    kind: "screenshot" | "leaderboard" | "figure" | "illustration" | "output-frame";
    src: string;
    caption?: string;
    credit?: string;
    query?: string;
  };
  /** 内嵌字幕条文本（画面元素，10-28 字压缩；缺失时 fallback narration.slice(0,28)） */
  subtitle?: string;
}

/** 新闻流标识（四方向）
 *  - ai-news: AI 新闻（全球 AI 动态，早晚双场）
 *  - intl-news: 国际新闻（取代原 world-news）
 *  - cn-news: 国内新闻
 *  - ent-news: 娱乐新闻（国内外）
 *  - world-news: 兼容旧值（deprecated），发布链仍可解析，新产出统一用 intl-news
 */
export type StreamId =
  | "ai-news"
  | "intl-news"
  | "cn-news"
  | "ent-news"
  | "world-news";
export type EditionId = "morning" | "evening";
export type Cadence = "daily" | "weekly";

export type VideoConfig = {
  /** 内容类型 */
  type: ContentType;
  /** 视觉风格 */
  style: VideoStyle;
  /** 视频标题 */
  title: string;
  /** 一句话摘要（用于封面/简介） */
  subtitle?: string;
  /** 渲染引擎（默认 remotion；ai-news 用 hyperframes） */
  engine?: RenderEngine;
  /** 视频模板（合成内部分支；默认 default） */
  template?: VideoTemplate;
  /** 章节 */
  chapters: VideoChapter[];
  /** 内容块（逐帧播放） */
  blocks: VideoBlock[];
  /** 角色进度条类型 */
  character?: CharacterType;
  /** AI 分享格式（Mac 桌面风格） */
  aiSharing?: {
    /** 屏幕录制视频路径 */
    screenRecording?: string;
    /** 数字人视频路径（可选） */
    avatarVideo?: string;
    /** 顶部标题 */
    windowTitle?: string;
  };
  /** 版权/署名信息 */
  footer?: string;
  /** BGM 路径（可选） */
  bgm?: string;
  /** 配音音频路径（可选，无则静音）；分段配音见 out/voiceover/ + timeline.json */
  voiceover?: string;
  /** ===== 双运行面 run 元数据（新增，全部可选以兼容旧 fixture）===== */
  /** 工作流标识（hyperframes | remotion） */
  workflowId?: string;
  /** 业务 run id（如 ai-news-morning-2026-08-28） */
  runId?: string;
  /** 内容流（ai-news | world-news） */
  stream?: StreamId;
  /** 场次（morning | evening）；GitHub/周更无 */
  edition?: EditionId;
  /** 节奏（daily | weekly） */
  cadence?: Cadence;
  /** 来源引用（URL + snapshot hash） */
  sourceRefs?: { url: string; sha256: string }[];
  /** 素材清单路径（media-manifest.json） */
  mediaManifestPath?: string;
  /** 审查报告路径（review 产物） */
  reviewReportPath?: string;
};

/** 各平台章节格式转换 */
export function chaptersToBilibili(
  chapters: VideoChapter[]
): { start_time: number; title: string }[] {
  return chapters.map((c) => {
    const [m, s] = c.start.split(":").map(Number);
    return { start_time: m * 60 + s, title: c.title };
  });
}

export function timeToSeconds(time: string): number {
  const parts = time.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}