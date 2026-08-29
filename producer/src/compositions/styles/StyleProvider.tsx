import React, { createContext, useContext } from "react";
import { AbsoluteFill } from "remotion";
import type { VideoStyle } from "../../data/types";
import { MinimalTechBackground } from "./MinimalTech";
import { WhiteboardBackground } from "./WhiteboardNotes";
import { StickyNotesBackground } from "./StickyNotes";
import { NewspaperBackground } from "./Newspaper";
import { JournalBackground } from "./Journal";

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
