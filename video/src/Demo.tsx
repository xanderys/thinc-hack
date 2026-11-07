import React from "react";
import { AbsoluteFill, OffthreadVideo, interpolate, staticFile, useCurrentFrame } from "remotion";
import { CAPTIONS } from "./captions";
import { FPS, H, W } from "./timeline";
import { INK, PAPER, SANS } from "./theme";

const Card: React.FC<{ start: number; end: number; text: string }> = ({ start, end, text }) => {
  const frame = useCurrentFrame();
  const a = start * FPS;
  const b = end * FPS;
  const opacity = interpolate(frame, [a, a + 8, b - 8, b], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (frame < a || frame > b) return null;
  return (
    <div style={{ position: "absolute", left: 64, bottom: 64, padding: "18px 26px", background: PAPER, color: INK, fontFamily: SANS, fontSize: 40, opacity }}>
      {text}
    </div>
  );
};

export const Demo: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: INK }}>
    <OffthreadVideo src={staticFile("footage/demo.mp4")} style={{ width: W, height: H, objectFit: "contain" }} />
    {CAPTIONS.map((c, i) => (
      <Card key={i} {...c} />
    ))}
  </AbsoluteFill>
);
