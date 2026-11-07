export const FPS = 30;
export const W = 1920;
export const H = 1080;
const s = (n: number) => Math.round(n * FPS);

export const INTRO = s(20);
export const DEMO = s(90);
export const CLOSE = s(10);
export const TOTAL = INTRO + DEMO + CLOSE;

// Intro phases, in frames from the start of Intro.
export const PUSH_START = s(5);
export const PUSH_LEN = s(2.5);
export const XRAY_START = s(9);
export const XRAY_LEN = s(1.5);
export const ANCHOR_STAGGER = s(1.2);
