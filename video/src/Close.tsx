import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { XRAY, CREDITS } from "./xray.config";
import { BLUE, MONO, PAPER, RULE_DARK, SANS, SERIF } from "./theme";

export const Close: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = (d: number) => spring({ frame: frame - d, fps, config: { damping: 200 } });
  const label = { fontFamily: MONO, fontSize: 22, letterSpacing: "0.14em", textTransform: "uppercase" as const };
  return (
    <AbsoluteFill style={{ backgroundColor: BLUE, color: PAPER, padding: "0 160px", justifyContent: "center", textAlign: "left" }}>
      <div style={{ fontFamily: SERIF, fontSize: 220, lineHeight: 1.02, letterSpacing: "-0.02em", opacity: p(0) }}>Marquee</div>
      <div style={{ height: 2, width: 1100 * p(8), background: RULE_DARK, margin: "36px 0 40px" }} />
      <div style={{ ...label, opacity: p(14) }}>Live</div>
      <div style={{ fontFamily: MONO, fontSize: 44, marginTop: 10, opacity: p(14) }}>https://marquee-reonic.vercel.app</div>
      <div style={{ ...label, marginTop: 48, opacity: p(22) }}>Team</div>
      <div style={{ fontFamily: SANS, fontSize: 48, marginTop: 10, opacity: p(22) }}>Xander, Zi Yuan, Jamon</div>
      {XRAY.mode === "model" && (
        <div style={{ position: "absolute", left: 160, bottom: 56, fontFamily: SANS, fontSize: 20, color: "rgb(244 241 234 / .72)", opacity: p(30) }}>{CREDITS}</div>
      )}
    </AbsoluteFill>
  );
};
