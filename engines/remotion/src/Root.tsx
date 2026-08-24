import { Composition } from "remotion";
import { HelloPaper } from "./HelloPaper";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="HelloPaper"
        component={HelloPaper}
        durationInFrames={300}
        fps={60}
        width={1920}
        height={1080}
      />
    </>
  );
};
