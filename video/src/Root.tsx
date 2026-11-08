import React from "react";
import { Composition, Still } from "remotion";
import { Main } from "./Main";
import { PlaceholderDemo, PlaceholderIntro } from "./Placeholders";
import { FPS, H, TOTAL, W } from "./timeline";
import { Launch, launchDuration } from "./launch/Launch";
import { defaultLaunchProps, LaunchProps } from "./launch/config";

export const Root: React.FC = () => (
  <>
    <Composition id="Main" component={Main} durationInFrames={TOTAL} fps={FPS} width={W} height={H} />
    <Composition
      id="Launch"
      component={Launch}
      fps={30}
      width={1080}
      height={1920}
      durationInFrames={launchDuration(defaultLaunchProps)}
      defaultProps={defaultLaunchProps}
      calculateMetadata={({ props }: { props: LaunchProps }) => ({ durationInFrames: launchDuration(props) })}
    />
    <Still id="PlaceholderIntro" component={PlaceholderIntro} width={W} height={H} />
    <Still id="PlaceholderDemo" component={PlaceholderDemo} width={W} height={H} />
  </>
);
