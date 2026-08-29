// RenderJobProps — Remotion 数据集渲染契约（§5.1）
//
// 所有字段必须是 JSON 可序列化（禁止文件句柄/函数/绝对路径传入 Chrome）。
// config 与 timeline 来自 run 目录（config/content.json + timeline/timeline.json）；
// voiceoverRoot 是 public/ 下的相对目录（render-batch 会把 run 音频复制过去），
// 组件用 staticFile(voiceoverRoot + "/<i>.wav") 取旁白。

import type { VideoConfig } from "./types";

export interface TimelineEntryDto {
  blockIndex: number;
  audioPath: string | null;
  audioDurationSec: number;
  targetFrames: number;
  globalStartSec: number;
}

export interface TimelineDto {
  entries: TimelineEntryDto[];
  totalFrames: number;
  fps: number;
}

export interface RenderJobProps {
  config?: VideoConfig;
  /** timeline（音画同步事实源）；缺省时组件用默认时长回退 */
  timeline?: TimelineDto;
  /** public/ 下旁白目录（如 "voiceover/ai-news-morning-2026-08-28"） */
  voiceoverRoot?: string;
  runId?: string;
}

/** Studio 预览/无数据时的占位 config（不读 src/data/today.json 单例） */
export const EMPTY_CONFIG: VideoConfig = {
  type: "recording",
  style: "minimal-tech",
  title: "未加载 run",
  chapters: [],
  blocks: [],
};