import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// 手帐风模板示例：方格纸底 + 便利贴拍入 + 手绘圈
// 证明引擎可用；正式组件库在 src/kit/ 中逐步建设。

const PAPER = "#FDFBF4";
const GRID = "rgba(120,160,220,0.14)";
const INK = "#3B3A36";
const RED = "#D2544A";
const YELLOW = "#F5B840";

export const HelloPaper: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const notePop = spring({ frame: frame - 20, fps, config: { damping: 12 } });
  const circleProgress = interpolate(frame, [60, 90], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(${GRID} 1px, transparent 1px), linear-gradient(90deg, ${GRID} 1px, transparent 1px)`,
        backgroundSize: "44px 44px",
        backgroundColor: PAPER,
        fontFamily: '"Kaiti SC", "STKaiti", serif',
        color: INK,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div style={{ fontSize: 96, fontWeight: 700 }}>
        课堂手帐引擎就绪
      </div>
      <div
        style={{
          marginTop: 40,
          padding: "28px 44px",
          background: "#FFF7DE",
          transform: `rotate(${(-1.5 + notePop * 1.5).toFixed(2)}deg) scale(${notePop})`,
          boxShadow: "0 14px 30px rgba(60,50,30,0.18)",
          fontSize: 52,
        }}
      >
        便利贴 spring 拍入 ✓
      </div>
      <svg
        width="420"
        height="180"
        viewBox="0 0 420 180"
        style={{ position: "absolute", right: 260, top: 200 }}
      >
        <ellipse
          cx="210"
          cy="90"
          rx="190"
          ry="72"
          fill="none"
          stroke={RED}
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray={1150}
          strokeDashoffset={1150 * (1 - circleProgress)}
          transform="rotate(-6 210 90)"
        />
      </svg>
      <div
        style={{
          position: "absolute",
          bottom: 90,
          fontSize: 40,
          background: YELLOW,
          padding: "10px 30px",
          transform: "rotate(1deg)",
        }}
      >
        荧光黄高亮 · dashoffset 逐笔画圈
      </div>
    </AbsoluteFill>
  );
};
