import React from "react";
import { useCurrentFrame } from "remotion";
import {
  evolvePath,
  getLength,
  getPointAtLength,
  getTangentAtLength,
} from "@remotion/paths";

interface Props {
  /** SVG path 数据（笔画顺序必须正确：从 M 起点到终点） */
  svgPath: string;
  /** 显示标签（如趋势线名称） */
  label?: string;
  /** 绘制总帧数 */
  duration?: number;
  /** 线条颜色 */
  strokeColor?: string;
  /** 线条宽度 */
  strokeWidth?: number;
  /** 手/笔的图片 URL（可选，默认用 emoji ✍️） */
  handImage?: string;
}

/**
 * #4.10 HandDrawing — 手绘动画效果
 *
 * 看到一只手/笔在屏幕上画画，绘画顺序正确：
 * - evolvePath(progress, path)：progress 0→1，路径从不可见到完全绘制
 * - interpolatePath(progress, path)：获取笔尖位置 + 角度，放置手/笔
 * - 多笔画：拆成多个 <path>，每个给不同 from/durationInFrames
 */
export const HandDrawing: React.FC<Props> = ({
  svgPath,
  label,
  duration = 75,
  strokeColor = "#e84118",
  strokeWidth = 4,
  handImage,
}) => {
  const frame = useCurrentFrame();
  const progress = Math.min(frame / duration, 1);

  // 路径绘制进度
  const evolution = evolvePath(progress, svgPath);

  // 笔尖当前位置和角度：按弧长取点 + 切线向量
  const totalLength = getLength(svgPath);
  const point = getPointAtLength(svgPath, totalLength * progress);
  const tangent = getTangentAtLength(svgPath, totalLength * progress);
  const pen =
    point && tangent
      ? {
          x: point.x,
          y: point.y,
          angle: (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI,
        }
      : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 24,
        width: "100%",
        height: "100%",
      }}
    >
      <svg
        viewBox="0 0 500 320"
        style={{ width: "100%", maxHeight: "70%", flex: 1 }}
      >
        {/* 已绘制的路径 */}
        <path
          d={svgPath}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={evolution.strokeDasharray}
          strokeDashoffset={evolution.strokeDashoffset}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* 完成后的终点标记 */}
        {progress >= 1 && pen ? (
          <circle cx={pen.x} cy={pen.y} r={strokeWidth * 2.2} fill={strokeColor} />
        ) : null}
        {/* 手/笔：跟随笔尖 */}
        {progress > 0.02 && progress < 0.98 && pen ? (
          handImage ? (
            <image
              href={handImage}
              x={pen.x - 28}
              y={pen.y - 34}
              width={56}
              height={56}
              style={{ transform: `rotate(${pen.angle}deg)`, transformOrigin: "28px 34px" }}
            />
          ) : (
            <text
              x={pen.x + 14}
              y={pen.y - 6}
              fontSize={44}
              style={{ transform: `rotate(${pen.angle * 0.4}deg)` }}
            >
              ✍️
            </text>
          )
        ) : null}
      </svg>
      {label ? (
        <div
          style={{
            fontFamily: "'Marker Felt', 'PingFang SC', cursive",
            fontSize: 40,
            color: strokeColor,
            opacity: Math.min(frame / 15, 1),
          }}
        >
          ✏️ {label}
        </div>
      ) : null}
    </div>
  );
};

/**
 * 常用手绘路径模板
 */
export const handDrawingPaths = {
  /** 波浪趋势线 */
  trendLine:
    "M60,240 C140,80 220,300 300,140 C340,70 380,100 440,60",
  /** 圆形（一笔画） */
  circle:
    "M250,60 a110,110 0 1,1 -0.01,0 z",
  /** 五角星 */
  star:
    "M250,40 L290,140 L400,140 L310,200 L340,300 L250,240 L160,300 L190,200 L100,140 L210,140 Z",
  /** 箭头（两条路径组成，需两个 HandDrawing 叠加） */
  arrowShaft: "M60,160 L420,160",
  arrowHead: "M380,120 L425,160 L380,200",
  /** 心形 */
  heart:
    "M250,280 C250,280 60,200 60,120 C60,70 110,50 150,80 C190,110 250,180 250,180 C250,180 310,110 350,80 C390,50 440,70 440,120 C440,200 250,280 250,280 Z",
  /** 放大镜 */
  magnifier:
    "M180,100 a80,80 0 1,0 0.01,0 z M240,160 L340,260",
};
