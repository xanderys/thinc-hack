import React from "react";
import { AbsoluteFill } from "remotion";
import { ANCHORS } from "./anchors";
import { W, H } from "./timeline";
import { MONO } from "./theme";

const line = "#3a3d3a";
export const PlaceholderIntro: React.FC = () => (
  <AbsoluteFill style={{ background: "#8A8B92" }}>
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <g fill="none" stroke={line} strokeWidth={5}>
        <path d="M480 560 L960 280 L1440 560 Z" />
        <rect x={560} y={560} width={800} height={380} />
        <rect x={180} y={680} width={380} height={260} />
        <rect x={250} y={740} width={240} height={200} />
        <rect x={700} y={680} width={120} height={260} />
        <rect x={1090} y={660} width={140} height={150} />
        <rect x={1400} y={780} width={130} height={140} />
        <circle cx={1465} cy={850} r={40} />
        <path d="M0 940 H1920" />
      </g>
      <text x={40} y={70} fontFamily={MONO} fontSize={36} fill={line}>PLACEHOLDER intro.mp4 (replace with real footage)</text>
    </svg>
  </AbsoluteFill>
);
export const PlaceholderDemo: React.FC = () => (
  <AbsoluteFill style={{ background: "#8A8B92", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: 64, color: line }}>
    PLACEHOLDER screen recording
  </AbsoluteFill>
);
void ANCHORS;
