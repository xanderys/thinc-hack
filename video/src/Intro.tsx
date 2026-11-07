import React from "react";
import { AbsoluteFill, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { ANCHORS, PUSH, type Anchor, type Pt, type Quad } from "./anchors";
import { labelFor } from "./home";
import { ANCHOR_STAGGER, H, PUSH_LEN, PUSH_START, W, XRAY_LEN, XRAY_START } from "./timeline";
import { ModelXray } from "./ModelXray";
import { XRAY } from "./xray.config";
import { BLUE, INK, MONO, PAPER } from "./theme";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function track<T>(kfs: { f: number; v: T }[], f: number, mix: (a: T, b: T, t: number) => T): T {
  if (f <= kfs[0].f) return kfs[0].v;
  for (let i = 1; i < kfs.length; i++) {
    if (f <= kfs[i].f) {
      const t = (f - kfs[i - 1].f) / (kfs[i].f - kfs[i - 1].f);
      return mix(kfs[i - 1].v, kfs[i].v, t);
    }
  }
  return kfs[kfs.length - 1].v;
}
const mixPt = (a: Pt, b: Pt, t: number): Pt => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
const mixQuad = (a: Quad, b: Quad, t: number): Quad => a.map((p, i) => mixPt(p, b[i], t)) as Quad;

const calm = { damping: 200, mass: 1, stiffness: 100 };
const use = (start: number, len: number) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - start, fps, config: calm, durationInFrames: len });
};

const Draw: React.FC<{ d: string; p: number; dashed?: boolean; width?: number; color?: string }> = ({ d, p, dashed, width = 3, color = BLUE }) => (
  <>
    {color === BLUE && <Stroke d={d} p={p} dashed={dashed} width={width + 6} color={PAPER} />}
    <Stroke d={d} p={p} dashed={dashed} width={width} color={color} />
  </>
);

const Stroke: React.FC<{ d: string; p: number; dashed?: boolean; width: number; color: string }> = ({ d, p, dashed, width, color }) => (
  <path
    d={d}
    pathLength={1}
    fill="none"
    stroke={color}
    strokeWidth={width}
    strokeLinejoin="miter"
    strokeDasharray={dashed && p >= 1 ? "0.012 0.012" : 1}
    strokeDashoffset={dashed && p >= 1 ? 0 : 1 - p}
  />
);

const AnchorLayer: React.FC<{ a: Anchor; i: number; project: (p: Pt) => Pt }> = ({ a, i, project }) => {
  const frame = useCurrentFrame();
  const start = XRAY_START + i * ANCHOR_STAGGER;
  const pOutline = use(start, XRAY_LEN);
  const pLeader = use(start + 12, XRAY_LEN);
  const pLabel = use(start + 30, XRAY_LEN);
  const quad = track(a.keyframes.map((k) => ({ f: k.f, v: k.pts })), frame, mixQuad);
  const s = quad.map(project) as Quad;
  const px = (p: Pt) => `${p[0] * W} ${p[1] * H}`;
  const outline = `M${px(s[0])} L${px(s[1])} L${px(s[2])} L${px(s[3])} Z`;
  const label = labelFor(a.id);

  const bil = (u: number, v: number): Pt => {
    const top = mixPt(s[0], s[1], u);
    const bot = mixPt(s[3], s[2], u);
    return mixPt(top, bot, v);
  };
  const gridLines: string[] = [];
  if (a.grid && !label.none) {
    for (let c = 1; c < a.grid.cols; c++) gridLines.push(`M${px(bil(c / a.grid.cols, 0))} L${px(bil(c / a.grid.cols, 1))}`);
    for (let r = 1; r < a.grid.rows; r++) gridLines.push(`M${px(bil(0, r / a.grid.rows))} L${px(bil(1, r / a.grid.rows))}`);
  }

  const cx = s.reduce((t, p) => t + p[0], 0) / 4;
  const cy = s.reduce((t, p) => t + p[1], 0) / 4;
  const boxW = Math.max(label.value.length * 26 + 36, label.name.length * 17 + 36);
  const boxH = 92;
  const ex = a.label.at[0] * W;
  const ey = a.label.at[1] * H;
  const dir = a.label.side === "right" ? 1 : -1;
  const leader = `M${cx * W} ${cy * H} L${ex - dir * 48} ${ey} L${ex} ${ey}`;
  const boxX = a.label.side === "right" ? ex : ex - boxW;

  return (
    <g>
      <Draw d={outline} p={pOutline} dashed={label.none} />
      {gridLines.map((d, k) => (
        <Draw key={k} d={d} p={pOutline} width={2} />
      ))}
      <Draw d={leader} p={pLeader} width={2} color={PAPER} />
      <g opacity={pLabel}>
        <rect x={boxX} y={ey - boxH / 2} width={boxW} height={boxH} fill={PAPER} />
        <text x={boxX + 18} y={ey - 10} fontFamily={MONO} fontSize={20} letterSpacing="0.14em" fill={INK}>
          {label.name}
        </text>
        <text x={boxX + 18} y={ey + 28} fontFamily={MONO} fontSize={38} fontWeight={500} fill={INK}>
          {label.value}
        </text>
      </g>
    </g>
  );
};

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const push = use(PUSH_START, PUSH_LEN);
  const xray = use(XRAY_START, XRAY_LEN);
  const scale = lerp(1, PUSH.scale, push);
  const f = track(PUSH.focus.map((k) => ({ f: k.f, v: k.at })), frame, mixPt);
  const fx = lerp(0.5, f[0], push);
  const fy = lerp(0.5, f[1], push);
  // screen = 0.5 + (p - focus) * scale
  const project = (p: Pt): Pt => [0.5 + (p[0] - fx) * scale, 0.5 + (p[1] - fy) * scale];
  const tx = (0.5 - fx * scale) * W;
  const ty = (0.5 - fy * scale) * H;

  return (
    <AbsoluteFill style={{ backgroundColor: INK }}>
      <AbsoluteFill
        style={{
          transformOrigin: "0 0",
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          filter: `saturate(${lerp(1, 0.08, xray)}) brightness(${lerp(1, 0.4, xray)})`,
        }}
      >
        <OffthreadVideo src={staticFile("footage/intro.mp4")} style={{ width: W, height: H, objectFit: "cover" }} />
      </AbsoluteFill>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0 }}>
        {XRAY.mode === "lines" && frame >= XRAY_START && (
          <text x={64} y={H - 56} fontFamily={MONO} fontSize={20} letterSpacing="0.14em" fill={PAPER} opacity={xray}>
            SAMPLE HOME, NOT THIS HOUSE
          </text>
        )}
        {XRAY.mode === "lines" && frame >= XRAY_START && ANCHORS.map((a, i) => <AnchorLayer key={a.id} a={a} i={i} project={project} />)}
      </svg>
      {XRAY.mode === "model" && frame >= XRAY_START && (
        <AbsoluteFill style={{ opacity: Math.min(1, (frame - XRAY_START) / 12) }}>
          <Sequence from={XRAY_START}>
            <ModelXray />
          </Sequence>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
