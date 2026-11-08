// Launch film, 9:16. All times are seconds on the film's own clock.
// Screen coordinates are CSS px of the 430x932 phone capture (stills are 3x).

export const FPS = 30;
export const W = 1080;
export const H = 1920;
export const sec = (n: number) => Math.round(n * FPS);

// The phone screen sits in the top of the frame; captions and number pops
// live in the paper zone below it, clear of the UI.
export const VIEW_H = 1300;
export const CSS_W = 430;
export const CSS_H = 932;

export type Hologram = {
  src: string; // path under public/
  from: number; // seconds into the source clip
  start: number; // seconds on the film clock
  len: number; // seconds the take covers on the film clock
  rate: number; // playback rate, so the take fills `len`
  focusX: number; // push-in focus, 0 to 1 of the frame
  focusY: number;
  pushStart: number; // film seconds where the push into the house begins
  pushScale: number; // extra zoom at the end of the push (0.35 = 1.35x)
};

export type LaunchProps = {
  intro: string; // raw room footage under public/, shown before the hologram take
  introFrom: number; // seconds into the raw footage where the film starts
  introRawEnd: number; // film seconds where the hologram take takes over (0: the take is the whole intro)
  roomSound: { src: string; from: number } | null; // ambient sound under the intro
  hologram: Hologram;
  musicSrc: string | null; // path under public/, plays from frame 0; the file carries its own fade-out
  musicVolume: number; // 0 to 1, lower it to duck under the VO
  captions: boolean; // burned-in captions (off since v2)
  voSrc: string | null; // recorded voiceover under public/, starts at 0
};

export const defaultLaunchProps: LaunchProps = {
  intro: "footage/zy.mp4",
  // holo-composite.mp4 is source 0.3 to 10.3 s with a tracked house, clean from frame 0.
  introFrom: 0.3,
  introRawEnd: 0,
  roomSound: { src: "footage/zy.mp4", from: 0.3 },
  hologram: {
    src: "capture/holo-composite.mp4",
    from: 0,
    start: 0,
    len: 10.0,
    rate: 1,
    // Composite of 16:25: the house sits left of Zi Yuan, centre about (0.24, 0.73) at 8.5 s
    // drifting to (0.26, 0.68) by 9.9 s, about a quarter of the width.
    focusX: 0.24,
    focusY: 0.71,
    pushStart: 8.5,
    pushScale: 0.7,
  },
  musicSrc: "music/moon-cut.mp3",
  musicVolume: 1,
  captions: false,
  voSrc: null,
};

// The app section is timed for an intro whose hologram ends at 10.5 s.
export const HOLO_END_PLANNED = 10.5;
export const TOTAL = 118.5;

export type Cam = { t: number; x: number; y: number; z: number };
export type Tap = { t: number; x: number; y: number };
export type Enter = "settle" | "slide" | "rise" | "fade" | "crossfade" | "cut";

export type Shot = {
  id: string;
  from: number;
  to: number;
  still?: string; // file in capture/
  clip?: { file: string; start: number; rate: number };
  cssW?: number; // capture width in CSS px, default 430
  cam: Cam[]; // t is seconds from the shot start
  taps?: Tap[];
  // Full-width strips of the still, placed at frame y `top`: shows only what is current.
  crops?: { y: number; y2?: number; h: number; top: number; delay?: number }[];
  // Crops only: a second still crossfaded in at `swapAt` seconds, in the same strips.
  still2?: string;
  swapAt?: number;
  // Crops only: slow push on the strips, scale at the end of the shot.
  cropZoom?: number;
  // Covers stray UI (a status line, a cursor) in the local background colour.
  masks?: { x: number; y: number; w: number; h: number; color: string }[];
  enter: Enter;
};

// r9 stills, recaptured on production 8 Nov 2026 (video/capture/figures-r9.md).
// Live bug: once the roof is measured the hero shows "Your edit", 27 panels, 12.15 kWp, €16,210.
// Every hero frame below is cropped or framed so none of those appear; the refinement runs on test lead 3273a47bbe.
const PAGE = "#fdfdfb";

export const SHOTS: Shot[] = [
  {
    id: "board", from: 10.5, to: 20, still: "r9-01-board.png", enter: "settle",
    cam: [
      { t: 0, x: 215, y: 330, z: 1.0 },
      { t: 3.8, x: 215, y: 330, z: 1.0 },
      { t: 5.0, x: 215, y: 600, z: 1.0 },
      { t: 8.2, x: 215, y: 600, z: 1.0 },
      { t: 8.9, x: 215, y: 330, z: 1.0 },
    ],
    taps: [{ t: 9.1, x: 215, y: 260 }],
  },
  // Hero, 23 panels 10.35 kWp, €14,620. "Measuring the roof" status line masked.
  {
    id: "hero", from: 20, to: 27, still: "r9-02-hero-top.png", enter: "slide",
    masks: [{ x: 10, y: 175, w: 140, h: 23, color: PAGE }],
    cam: [
      { t: 0, x: 215, y: 259, z: 1.0 },
      { t: 3.2, x: 215, y: 259, z: 1.0 },
      // Between the time row (ends at 398) and the map toolbar (starts at 803).
      { t: 4.4, x: 215, y: 616, z: 1.4 },
      { t: 7.0, x: 210, y: 616, z: 1.45 },
    ],
  },
  // Shade, 09:30 to 18:30: the time row and the east face only (the morning still carries the bug in its card).
  {
    id: "shade", from: 27, to: 33.5, still: "r9-03-hero-shading-morning.png", still2: "r9-03-hero-shading-evening.png",
    swapAt: 2.8, cropZoom: 1.05, enter: "fade", cam: [],
    // The evening page sits 24 css px lower and its map 11 px lower (aligned on the 20 panels block).
    crops: [
      { y: 352, y2: 376, h: 48, top: 170 },
      { y: 570, y2: 581, h: 220, top: 380, delay: 0.2 },
    ],
  },
  {
    id: "battery", from: 33.5, to: 37.5, still: "r9-04-hero-chip-battery.png", enter: "slide",
    cam: [
      { t: 0, x: 215, y: 430, z: 1.0 },
      { t: 3.0, x: 215, y: 488, z: 1.0 },
    ],
    taps: [{ t: 0.15, x: 185, y: 204 }],
  },
  {
    id: "wallbox", from: 37.5, to: 41.5, still: "r9-04-hero-chip-wallbox.png", enter: "fade",
    cam: [
      { t: 0, x: 215, y: 430, z: 1.0 },
      { t: 3.0, x: 215, y: 488, z: 1.0 },
    ],
    taps: [{ t: 0.15, x: 258, y: 204 }],
  },
  {
    id: "heatpump", from: 41.5, to: 45.5, still: "r9-04-hero-chip-heatpump.png", enter: "fade",
    cam: [
      { t: 0, x: 215, y: 430, z: 1.0 },
      { t: 3.0, x: 215, y: 440, z: 1.0 },
    ],
    taps: [{ t: 0.15, x: 331, y: 204 }],
  },
  // Proposed Design: the alternatives above the bugged "Your edit" card.
  {
    id: "design", from: 45.5, to: 52.5, still: "r9-05-hero-design-card-2.png", enter: "rise", cam: [],
    crops: [{ y: 178, h: 472, top: 60 }],
  },
  // Refinement on the test lead: no car, €14,620.
  {
    id: "refine-before", from: 52.5, to: 56, still: "r9-06-refine-before.png", enter: "slide", cam: [],
    crops: [
      { y: 345, h: 160, top: 120 },
      { y: 868, h: 64, top: 600, delay: 0.3 },
    ],
  },
  {
    id: "refine-chip", from: 56, to: 59, still: "r9-06-refine-chip-open.png", enter: "fade",
    cam: [
      { t: 0, x: 215, y: 290, z: 1.0 },
      { t: 2.0, x: 215, y: 300, z: 1.04 },
    ],
    taps: [
      { t: 0.2, x: 338, y: 254 },
      { t: 2.4, x: 56, y: 312 },
    ],
  },
  // Clip: "Have one" switching on, 15000 km a year. Only the full-size stretch (9.24 to 14.76 s) of the screencast is used.
  {
    id: "refine-clip", from: 59, to: 60.6, enter: "cut",
    clip: { file: "r9-06-refine-ev.mp4", start: 9.3, rate: 1 },
    cam: [{ t: 0, x: 215, y: 300, z: 1.0 }],
  },
  {
    id: "refine-wallbox", from: 60.6, to: 65.5, still: "r9-06-refine-after-wallbox.png", enter: "fade",
    cam: [
      { t: 0, x: 215, y: 540, z: 1.0 },
      { t: 2.0, x: 215, y: 565, z: 1.1 },
    ],
    taps: [{ t: 0.15, x: 258, y: 310 }],
  },
  {
    id: "refine-after", from: 65.5, to: 70.5, still: "r9-06-refine-after-clean.png", enter: "slide", cam: [],
    crops: [
      { y: 345, h: 175, top: 120 },
      { y: 868, h: 64, top: 600, delay: 0.3 },
    ],
  },
  {
    id: "complete", from: 70.5, to: 76, still: "r9-07-complete-copied.png", enter: "slide", cam: [],
    crops: [
      { y: 58, h: 66, top: 60 },
      { y: 600, h: 320, top: 290, delay: 0.25 },
    ],
  },
  {
    id: "proposal-top", from: 76, to: 81, still: "r9-08-proposal-top.png", enter: "slide",
    cam: [
      { t: 0, x: 215, y: 259, z: 1.0 },
      { t: 4.0, x: 215, y: 259, z: 1.0 },
    ],
  },
  {
    id: "proposal-kit", from: 81, to: 85.5, still: "r9-08-proposal-kit.png", enter: "fade",
    cam: [
      { t: 0, x: 215, y: 330, z: 1.0 },
      { t: 4.0, x: 215, y: 350, z: 1.04 },
    ],
  },
  {
    id: "sign", from: 85.5, to: 89.5, still: "r9-09-sign-filled.png", enter: "slide",
    cam: [
      { t: 0, x: 215, y: 420, z: 1.0 },
      { t: 3.5, x: 215, y: 430, z: 1.0 },
    ],
    taps: [
      { t: 1.2, x: 46, y: 552 },
      { t: 2.4, x: 215, y: 601 },
    ],
  },
  // Signed: stops above the "about 20 days" comparison line.
  {
    id: "signed", from: 89.5, to: 93.5, still: "r9-09-signed.png", enter: "fade", cam: [],
    crops: [{ y: 176, h: 166, top: 420 }],
  },
  {
    id: "planner-signed", from: 93.5, to: 97.5, still: "r9-10-lead-signed.png", enter: "slide", cam: [],
    crops: [
      { y: 55, h: 70, top: 60 },
      { y: 238, h: 178, top: 330, delay: 0.25 },
    ],
  },
  {
    id: "check", from: 97.5, to: 106.5, still: "r9-11-check.png", enter: "slide", cam: [],
    cropZoom: 1.03,
    crops: [{ y: 56, h: 444, top: 80 }],
  },
  {
    id: "heldout", from: 106.5, to: 113.5, still: "r9-11-check.png", enter: "rise", cam: [],
    crops: [{ y: 528, h: 404, top: 120 }],
  },
];

export type Caption = { from: number; to: number; text: string };

// No captions since v2.
export const CAPTIONS: Caption[] = [];

export type Pop = { from: number; to: number; value: string; label: string };

export const POPS: Pop[] = [
  { from: 21.4, to: 24.2, value: "10.35 kWp", label: "23 panels, fits the roof" },
  { from: 34.0, to: 36.8, value: "10 kWh", label: "battery" },
  { from: 42.2, to: 45.0, value: "17.2 kW", label: "heat loss at -16 °C, upper bound" },
  { from: 47.0, to: 49.8, value: "€14,620", label: "planners' pick, estimate, break-even 10 years" },
  { from: 53.0, to: 55.6, value: "€14,620", label: "test lead, no electric car" },
  { from: 61.6, to: 64.4, value: "11 kW", label: "wallbox, 15,000 km a year, 5.9 kWh a night" },
  { from: 66.6, to: 69.4, value: "€15,820", label: "with the car, was €14,620" },
  { from: 90.0, to: 92.8, value: "5 min 31 s", label: "enquiry to signature, this run" },
  { from: 99.0, to: 101.8, value: "633", label: "sealed held-out signed homes" },
  { from: 102.6, to: 105.4, value: "18.6 %", label: "Marquee draft, all four parts within. Textbook rule 6.8 %" },
];

// Plain beat labels in the paper zone, shown whenever no number pop is up.
export const LABELS: { from: number; to: number; text: string }[] = [
  { from: 10.5, to: 20, text: "Enquiry" },
  { from: 20, to: 52.5, text: "Design" },
  { from: 52.5, to: 70.5, text: "Refined" },
  { from: 70.5, to: 85.5, text: "Offer" },
  { from: 85.5, to: 97.5, text: "Signed" },
  { from: 97.5, to: 113.5, text: "Checked" },
];

export const CLOSE_FROM = 113.5;
export const CLOSE = {
  name: "Marquee",
  url: "marquee-reonic.vercel.app",
  team: "Xander, Zi Yuan, Jamon",
};
