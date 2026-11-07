// Normalised (0..1) coordinates in the footage frame, origin top left.
// Each anchor has keyframes: f is the frame inside Intro, pts are the four
// corners of the region. Values between keyframes are interpolated linearly,
// so a handheld shot can be tracked by hand with a few keyframes.
// PLACEHOLDER values match public/footage/intro.mp4 (drawn house).

export type Pt = [number, number];
export type Quad = [Pt, Pt, Pt, Pt];
export type Keyframe = { f: number; pts: Quad };
export type AnchorId = "pv" | "battery" | "heatpump" | "wallbox";
export type Anchor = {
  id: AnchorId;
  keyframes: Keyframe[];
  // Where the leader ends, in screen space (after the push-in), and which way the label extends.
  label: { at: Pt; side: "left" | "right" };
  grid?: { cols: number; rows: number };
};

const n = (x: number, y: number): Pt => [x / 1920, y / 1080];
const q = (a: Pt, b: Pt, c: Pt, d: Pt): Quad => [n(...a), n(...b), n(...c), n(...d)];

// Push-in focus: footage point that lands at screen centre, and zoom factor.
export const PUSH = {
  scale: 1.3,
  focus: [
    { f: 0, at: n(960, 600) },
  ] as { f: number; at: Pt }[],
};

export const ANCHORS: Anchor[] = [
  {
    id: "pv",
    keyframes: [{ f: 0, pts: q([600, 505], [920, 318], [920, 365], [600, 552]) }],
    label: { at: [0.72, 0.13], side: "right" },
    grid: { cols: 6, rows: 2 },
  },
  {
    id: "battery",
    keyframes: [{ f: 0, pts: q([1090, 660], [1230, 660], [1230, 810], [1090, 810]) }],
    label: { at: [0.72, 0.4], side: "right" },
  },
  {
    id: "heatpump",
    keyframes: [{ f: 0, pts: q([1400, 780], [1530, 780], [1530, 920], [1400, 920]) }],
    label: { at: [0.8, 0.62], side: "right" },
  },
  {
    id: "wallbox",
    keyframes: [{ f: 0, pts: q([470, 700], [535, 700], [535, 790], [470, 790]) }],
    label: { at: [0.1, 0.68], side: "left" },
  },
];
