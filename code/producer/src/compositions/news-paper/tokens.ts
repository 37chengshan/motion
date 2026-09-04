// news-paper tokens — 对标《AI早报/晚报》双皮肤（doc/09 §新闻方向对标，2026-09-04 逐帧逆向）
// 浅皮 = 日间档（橘鸦早报 #FBF8F2 系）/ 深皮 = 晚间档（黑鸦晚报 ~#101018 系）。
// 骨架共用一套组件（NewsPaper.tsx），皮肤只换本文件 token —— "换 token 不换骨架"。
// 我方差异： Morning/Evening 场次自动换肤（resolvePaperTokens 按 edition），无需逐片配置。

import type { EditionId, VideoStyle } from "../../data/types";

export interface PaperTokens {
  dark: boolean;
  /** 全片背景（全片恒定不切换，对齐对方"聚合页"质感） */
  bg: string;
  /** 卡片底 */
  surface: string;
  /** 卡片描边 */
  border: string;
  /** 主文字 */
  text: string;
  /** 次要文字（日期/来源行/脚注） */
  textMuted: string;
  /** 大标题色（浅皮=深红 / 深皮=暖白） */
  title: string;
  /** 语义分级强调色：高优先级/财务 */
  red: string;
  /** 标准/中性 */
  orange: string;
  /** 次要/补充 */
  green: string;
  /** 负向/回落 */
  cyan: string;
  /** 链接（来源行/T5 虚线下划线） */
  blue: string;
  /** 频道贴纸底/字 */
  stickerBg: string;
  stickerFg: string;
  /** tab 选中底/字 */
  tabActiveBg: string;
  tabActiveFg: string;
  fontFamily: string;
  /** 字幕形态：浅皮=深灰 chip 白字 / 深皮=白字黑描边（V2 实测） */
  subtitleStyle: "chip" | "outline";
}

export const PAPER_LIGHT: PaperTokens = {
  dark: false,
  bg: "#FBF8F2",
  surface: "#FFFFFF",
  border: "#E8E5E0",
  text: "#1F1F1F",
  textMuted: "#7A7A7A",
  title: "#C0392B",
  red: "#D14545",
  orange: "#E67E22",
  green: "#16A085",
  cyan: "#1ABC9C",
  blue: "#1DA1F2",
  stickerBg: "#4A4A4A",
  stickerFg: "#FFFFFF",
  tabActiveBg: "#C0392B",
  tabActiveFg: "#FFFFFF",
  fontFamily: "Inter, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
  subtitleStyle: "chip",
};

export const PAPER_DARK: PaperTokens = {
  dark: true,
  bg: "#101018",
  surface: "#1A1A24",
  border: "#2A2A38",
  text: "#F5F1E8",
  textMuted: "#9A97A8",
  title: "#F5F1E8",
  red: "#E05A52",
  orange: "#EE8A3C",
  green: "#1FB89B",
  cyan: "#22C9AD",
  blue: "#4DA6FF",
  stickerBg: "#E9E4D8",
  stickerFg: "#16161E",
  tabActiveBg: "#D14545",
  tabActiveFg: "#FFFFFF",
  fontFamily: "Inter, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
  subtitleStyle: "outline",
};

/**
 * 解析当前片应使用的纸媒 token。
 * - "news-paper-dark"：强制深皮
 * - "news-paper"：按场次自动（evening → 深皮，其余 → 浅皮）—— 我方创新：早晚双场零配置换肤
 * - 其它 style：回退浅皮（模板仍可用，只是配色随纸媒浅皮）
 */
export const resolvePaperTokens = (
  style: VideoStyle | undefined,
  edition?: EditionId
): PaperTokens => {
  if (style === "news-paper-dark") return PAPER_DARK;
  if (style === "news-paper") return edition === "evening" ? PAPER_DARK : PAPER_LIGHT;
  return PAPER_LIGHT;
};

/** 语义 icon 颜色轮换序（无 block.icon 覆盖时按卡内序号轮换，保证同屏四色语义分明） */
export const ICON_COLOR_CYCLE = ["red", "orange", "green", "cyan"] as const;
export type IconColorName = (typeof ICON_COLOR_CYCLE)[number];

export const paperColor = (t: PaperTokens, name: IconColorName): string =>
  name === "red" ? t.red : name === "orange" ? t.orange : name === "green" ? t.green : t.cyan;
