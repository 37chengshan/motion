import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

interface Props {
  /** 窗口标题 */
  title?: string;
  /** 中间屏幕录制窗口内容（静态图片 URL 或占位） */
  screenImage?: string;
  /** 右下角虚拟数字人 emoji 或图片 URL */
  avatar?: string;
  /** 主讲人名字 */
  presenter?: string;
}

/**
 * AI 分享视频格式 — Mac 桌面风格
 * - 顶部 macOS 菜单栏 + Dock 图标
 * - 中间大屏幕录制窗口（带红绿灯按钮 + 流动渐变边框）
 * - 右下角虚拟数字人圆形头像（呼吸动画）
 */
export const MacDesktopFormat: React.FC<Props> = ({
  title = "AI 分享",
  screenImage,
  avatar = "🤖",
  presenter = "AI 助手",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 窗口弹入
  const windowScale = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 120 },
  });

  // 流动边框：渐变角度随时间旋转
  const borderAngle = interpolate(frame % fps, [0, fps], [0, 360]);

  // 数字人呼吸
  const breathe = 1 + Math.sin(frame / (fps / 4)) * 0.04;

  return (
    <AbsoluteFill style={{ background: "linear-gradient(160deg, #1a1d2e, #0d0f18)" }}>
      {/* 顶部菜单栏 */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 44,
          background: "rgba(255,255,255,0.08)",
          backdropFilter: "blur(20px)",
          display: "flex",
          alignItems: "center",
          paddingLeft: 60,
          paddingRight: 40,
          justifyContent: "space-between",
          fontFamily: "sans-serif",
          color: "rgba(255,255,255,0.85)",
          fontSize: 20,
        }}
      >
        <span>{title}</span>
        <span style={{ display: "flex", gap: 24 }}>
          <span>🔋</span>
          <span>📶</span>
          <span>🗓️</span>
        </span>
      </div>

      {/* 中间屏幕录制窗口 */}
      <div
        style={{
          position: "absolute",
          top: 110,
          left: "10%",
          right: "10%",
          bottom: 220,
          transform: `scale(${windowScale})`,
          borderRadius: 18,
          overflow: "hidden",
          padding: 3,
          background: `conic-gradient(from ${borderAngle}deg, #007AFF, #5ac8fa, #ff9ff3, #007AFF)`,
          boxShadow: "0 40px 120px rgba(0,0,0,0.6)",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 15,
            background: "#000",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* 窗口标题栏 */}
          <div
            style={{
              height: 46,
              background: "#1e1e24",
              display: "flex",
              alignItems: "center",
              paddingLeft: 20,
              gap: 10,
            }}
          >
            <span style={{ width: 14, height: 14, borderRadius: "50%", background: "#ff5f57" }} />
            <span style={{ width: 14, height: 14, borderRadius: "50%", background: "#febc2e" }} />
            <span style={{ width: 14, height: 14, borderRadius: "50%", background: "#28c840" }} />
            <span
              style={{
                marginLeft: 16,
                color: "rgba(255,255,255,0.6)",
                fontSize: 16,
                fontFamily: "sans-serif",
              }}
            >
              {title}
            </span>
          </div>
          {/* 屏幕内容 */}
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: screenImage
                ? `url(${screenImage}) center/cover`
                : "linear-gradient(135deg, #2d2d3a, #1a1a24)",
              color: "rgba(255,255,255,0.4)",
              fontSize: 40,
              fontFamily: "sans-serif",
            }}
          >
            {screenImage ? "" : "Screen Recording"}
          </div>
        </div>
      </div>

      {/* 右下角虚拟数字人 */}
      <div
        style={{
          position: "absolute",
          right: 70,
          bottom: 170,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            width: 140,
            height: 140,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #5ac8fa, #007AFF)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 64,
            transform: `scale(${breathe})`,
            boxShadow: "0 16px 48px rgba(0,122,255,0.45)",
            border: "3px solid rgba(255,255,255,0.9)",
          }}
        >
          {avatar}
        </div>
        <div
          style={{
            background: "rgba(255,255,255,0.12)",
            borderRadius: 999,
            padding: "6px 20px",
            color: "#fff",
            fontSize: 22,
            fontFamily: "sans-serif",
          }}
        >
          {presenter}
        </div>
      </div>

      {/* 底部 Dock */}
      <div
        style={{
          position: "absolute",
          bottom: 30,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          gap: 22,
          padding: "14px 24px",
          background: "rgba(255,255,255,0.1)",
          backdropFilter: "blur(24px)",
          borderRadius: 24,
        }}
      >
        {["🧠", "📊", "🎯", "💡", "⚙️", "📁"].map((icon, i) => (
          <div
            key={i}
            style={{
              width: 58,
              height: 58,
              borderRadius: 14,
              background: "rgba(255,255,255,0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 30,
            }}
          >
            {icon}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
