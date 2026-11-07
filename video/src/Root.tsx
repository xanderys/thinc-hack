import React from "react";
import { Composition, Still } from "remotion";
import { Main } from "./Main";
import { PlaceholderDemo, PlaceholderIntro } from "./Placeholders";
import { FPS, H, TOTAL, W } from "./timeline";

export const Root: React.FC = () => (
  <>
    <Composition id="Main" component={Main} durationInFrames={TOTAL} fps={FPS} width={W} height={H} />
    <Still id="PlaceholderIntro" component={PlaceholderIntro} width={W} height={H} />
    <Still id="PlaceholderDemo" component={PlaceholderDemo} width={W} height={H} />
  </>
);
