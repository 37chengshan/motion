import React, { createContext, useContext } from "react";
import { AbsoluteFill } from "remotion";
import type { VideoStyle } from "../../data/types";
import { MinimalTechBackground } from "./MinimalTech";
import { WhiteboardBackground } from "./WhiteboardNotes";
import { StickyNotesBackground } from "./StickyNotes";
import { NewspaperBackground } from "./Newspaper";
import { JournalBackground } from "./Journal";
import { NewsPaperBackground } from "../news-paper/NewsPaper";

export interface StyleTheme {
  /** 主背景色 */
  background: string;
  /** 主文字色 */
  text: string;
  /** 强调色 */
  accent: string;
  /** 次要文字色 */
  muted: string;
  /** 卡片/面板背景 */
  panel: string;
  /** 字体 */
  fontFamily: string;
  /** 标题字体 */
  titleFont: string;
}

export const styleThemes: Record<VideoStyle, StyleTheme> = {
  "minimal-tech": {
    background: "#ffffff",
    text: "#1d1d1f",
    accent: "#007AFF",
    muted: "#86868b",
    panel: "#f5f5f7",
    fontFamily: "SF Pro Display, -apple-system, 'PingFang SC', sans-serif",
    titleFont: "SF Pro Display, -apple-system, 'PingFang SC', sans-serif",
  },
  whiteboard: {
    background: "#f7f6f2",
    text: "#333333",
    accent: "#e84118",
    muted: "#7f8c8d",
    panel: "#ffffff",
    fontFamily: "'Marker Felt', 'Comic Sans MS', 'PingFang SC', cursive",
    titleFont: "'Marker Felt', 'Comic Sans MS', 'PingFang SC', cursive",
  },
  "sticky-notes": {
    background: "#fdf6ec",
    text: "#3d3d3d",
    accent: "#feca57",
    muted: "#95a5a6",
    panel: "#fff9e6",
    fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif",
    titleFont: "'PingFang SC', 'Microsoft YaHei', sans-serif",
  },
  newspaper: {
    background: "#f5f0e1",
    text: "#2c2c2c",
    accent: "#8b0000",
    muted: "#6b6b6b",
    panel: "#faf6ea",
    fontFamily: "'Songti SC', 'STSong', 'SimSun', serif",
    titleFont: "'Songti SC', 'STSong', 'SimSun', serif",
  },
  journal: {
    background: "#fdfbf7",
    text: "#444444",
    accent: "#e17055",
    muted: "#a0a0a0",
    panel: "#fffdf8",
    fontFamily: "'Xingkai SC', 'KaiTi', 'STKaiti', cursive",
    titleFont: "'Xingkai SC', 'KaiTi', 'STKaiti', cursive",
  },
  // 聚合页纸媒（对标《AI早报/晚报》，2026-09-04 逆向；细粒度 token 见 compositions/news-paper/tokens.ts）
  // StyleProvider 只提供粗粒度主题（bg 供背景层），NewsPaper 模板内部用 resolvePaperTokens 双皮肤
  "news-paper": {
    background: "#FBF8F2",
    text: "#1F1F1F",
    accent: "#C0392B",
    muted: "#7A7A7A",
    panel: "#FFFFFF",
    fontFamily: "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif",
    titleFont: "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif",
  },
  "news-paper-dark": {
    background: "#101018",
    text: "#F5F1E8",
    accent: "#D14545",
    muted: "#9A97A8",
    panel: "#1A1A24",
    fontFamily: "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif",
    titleFont: "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif",
  },
  // TODO(dark-tech): 对标 Milvus 天花板 #0B1220/#22D3EE，见 vido/docs/styles.md §6
  // 需新增 "dark-tech": { background: "#0B1220", text: "#F9FAFB", accent: "#22D3EE", muted: "#1A2332", panel: "#111827", fontFamily: "Inter, 'PingFang SC', sans-serif", titleFont: "Inter, 'PingFang SC', sans-serif" }
  // 并新建 vido/src/compositions/styles/DarkTechBackground.tsx（网格+渐变+光晕），在 StyleProvider 背景分发处加 case "dark-tech"
};

interface StyleContextValue {
  theme: StyleTheme;
  orientation: "short" | "long";
}

const StyleContext = createContext<StyleContextValue>({
  theme: styleThemes["minimal-tech"],
  orientation: "short",
});

export const useStyle = () => useContext(StyleContext);

interface Props {
  style: VideoStyle;
  orientation: "short" | "long";
  children: React.ReactNode;
}

/**
 * 风格提供者：注入主题色 + 渲染背景装饰
 */
export const StyleProvider: React.FC<Props> = ({
  style,
  orientation,
  children,
}) => {
  const theme = styleThemes[style];

  const Background =
    style === "minimal-tech"
      ? MinimalTechBackground
      : style === "whiteboard"
        ? WhiteboardBackground
        : style === "sticky-notes"
          ? StickyNotesBackground
          : style === "newspaper"
            ? NewspaperBackground
            : style === "news-paper" || style === "news-paper-dark"
              ? NewsPaperBackground
              : JournalBackground;

  return (
    <StyleContext.Provider value={{ theme, orientation }}>
      <AbsoluteFill style={{
backgroundColor: theme.background,
scale: 1.035,
translate: "31.7px 50.8px"
}}>
        <Background />
        {children}
      </AbsoluteFill>
    </StyleContext.Provider>
  );
};
