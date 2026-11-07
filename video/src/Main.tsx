import React from "react";
import { Sequence } from "remotion";
import { Intro } from "./Intro";
import { Demo } from "./Demo";
import { Close } from "./Close";
import { CLOSE, DEMO, INTRO } from "./timeline";

export const Main: React.FC = () => (
  <>
    <Sequence from={0} durationInFrames={INTRO}><Intro /></Sequence>
    <Sequence from={INTRO} durationInFrames={DEMO}><Demo /></Sequence>
    <Sequence from={INTRO + DEMO} durationInFrames={CLOSE}><Close /></Sequence>
  </>
);
