import React from "react";
import { AbsoluteFill, Audio, Composition, Sequence, interpolate, staticFile } from "remotion";
import { Paper, PageFlip, ProgressCat } from "./kit";
import { Hook, Pain, Intro, Flow } from "./scenes/part1";
import { Case, Outcome, Verdict, Terminal } from "./scenes/part2";
import { WebTour, ReportCards, Viz, OSS, CTA, End } from "./scenes/part3";
import { Agent1, Agent2, Finale } from "./scenes/agent";

const FPS = 60;
const f = (sec: number) => Math.round(sec * FPS);

/* ================= 时间轴（秒） ================= */
type Seg = { comp: React.FC; start: number; end: number };

const BASE: Seg[] = [
  { comp: Hook, start: 0, end: 31 },
  { comp: Pain, start: 31, end: 64.5 },
  { comp: Intro, start: 64.5, end: 85 },
  { comp: Flow, start: 85, end: 141 },
  { comp: Case, start: 141, end: 185.5 },
  { comp: Outcome, start: 185.5, end: 207.5 },
  { comp: Verdict, start: 207.5, end: 224 },
  { comp: Terminal, start: 224, end: 240.5 },
];

const V1_SEG: Seg[] = [
  ...BASE,
  { comp: () => <WebTour videoDur={21} />, start: 240.5, end: 262 },
  { comp: ReportCards, start: 262, end: 285.5 },
  { comp: Viz, start: 285.5, end: 327 },
  { comp: OSS, start: 327, end: 344 },
  { comp: CTA, start: 344, end: 362 },
  { comp: End, start: 362, end: 372 },
];

const V2_SEG: Seg[] = [
  ...BASE,
  { comp: Agent1, start: 240.5, end: 266 },
  { comp: Agent2, start: 266, end: 297.5 },
  { comp: () => <WebTour long videoDur={56.3} />, start: 297.5, end: 361.5 },
  { comp: ReportCards, start: 361.5, end: 385.5 },
  { comp: Viz, start: 385.5, end: 427 },
  { comp: OSS, start: 427, end: 444 },
  { comp: Finale, start: 444, end: 456.5 },
  { comp: CTA, start: 456.5, end: 474.5 },
  { comp: End, start: 474.5, end: 484.5 },
];

/* ================= 配音（秒） ================= */
const VO_V1: [string, number][] = [
  ["vo-s1", 0.8], ["vo-s2", 31.4], ["vo-s3", 64.9], ["vo-s4", 85.4],
  ["vo-s5", 141.4], ["vo-s6", 185.9], ["vo-s7", 207.9], ["vo-s10", 224.4],
  ["vo-w1", 240.9], ["vo-w2", 262.4], ["vo-viz", 286.1], ["vo-s8", 327.4], ["vo-s9", 340.8],
];
const VO_V2: [string, number][] = [
  ...VO_V1.slice(0, 8),
  ["vo-m1", 241], ["vo-m2", 266.5],
  ["vo-w1", 298.5], ["vo-w3", 318.5], ["vo-w2", 361.9],
  ["vo-viz", 386.1], ["vo-s8", 427.4],
  ["vo-m3", 444.8], ["vo-s9", 457.3],
];

/* ================= 场景切换翻页点 ================= */
const flips = (segs: Seg[]) => segs.slice(1).map((s) => s.start);

const VideoBody: React.FC<{ segs: Seg[]; vos: [string, number][]; total30: number; bgmDur: number; sitAt: number }> = ({
  segs, vos, total30, bgmDur, sitAt,
}) => (
  <Paper>
    <AbsoluteFill>
      {segs.map(({ comp: Comp, start, end }, i) => (
        <Sequence key={i} from={f(start)} durationInFrames={f(end) - f(start)}>
          <Comp />
        </Sequence>
      ))}
    </AbsoluteFill>
    {/* 场景切换翻页 */}
    {flips(segs).map((t) => (
      <PageFlip key={t} at={t * 30 - 13} />
    ))}
    {/* 进度猫 */}
    <ProgressCat duration30={total30} sitFrom={sitAt * 30} />
    {/* 配音：Sequence 定位挂载点 */}
    {vos.map(([name, sec]) => (
      <Sequence key={name} from={f(sec)}>
        <Audio src={staticFile(`audio/${name}.mp3`)} />
      </Sequence>
    ))}
    {/* BGM：0.16 底量 + 片尾淡出（Audio 放在 Sequence 外，用 volume 回调） */}
    <Sequence from={0}>
      <Audio
        src={staticFile("audio/bgm-long.mp3")}
        volume={(frame) => {
          const fadeStart = bgmDur * FPS - 4 * FPS;
          if (frame < fadeStart) return 0.16;
          return interpolate(frame, [fadeStart, bgmDur * FPS], [0.16, 0], { extrapolateRight: "clamp" });
        }}
      />
    </Sequence>
  </Paper>
);

/* defaultProps 会被 JSON 序列化（函数丢失），故用闭包包装组件 */
const V1Video: React.FC = () => (
  <VideoBody segs={V1_SEG} vos={VO_V1} total30={372 * 30} bgmDur={372} sitAt={362} />
);
const V2Video: React.FC = () => (
  <VideoBody segs={V2_SEG} vos={VO_V2} total30={484.5 * 30} bgmDur={484.5} sitAt={474.5} />
);

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="V1"
        component={V1Video}
        durationInFrames={f(372)}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="V2"
        component={V2Video}
        durationInFrames={f(484.5)}
        fps={FPS}
        width={1920}
        height={1080}
      />
    </>
  );
};
