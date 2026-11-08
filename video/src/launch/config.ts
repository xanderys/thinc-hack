// Launch film, 9:16. All times are seconds on the film's own clock.
// Screen coordinates are CSS px of the 430x932 phone capture (stills are 3x).
import taps from "../../capture/taps.json";

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
};

export type LaunchProps = {
  intro: string; // raw room footage under public/, shown before the hologram take
  introRawEnd: number; // where the hologram take takes over (0: the take is the whole intro)
  roomSound: { src: string; from: number } | null; // ambient sound under the intro
  hologram: Hologram;
  musicSrc: string | null; // path under public/, plays from frame 0; the file carries its own fade-out
  musicVolume: number; // 0 to 1, lower it to duck under the VO
  voSrc: string | null; // recorded voiceover under public/, starts at 0
};

export const defaultLaunchProps: LaunchProps = {
  intro: "footage/zy.mp4",
  introRawEnd: 0,
  roomSound: { src: "footage/zy.mp4", from: 0.3 },
  // Take 2 covers the whole intro; a take 3 with the same timing swaps in by path.
  hologram: {
    src: "capture/holo-take2.mp4",
    from: 0,
    start: 0,
    len: 10.04,
    rate: 1,
    focusX: 0.32,
    focusY: 0.72,
    pushStart: 8.5,
  },
  musicSrc: "music/moon-cut.mp3",
  musicVolume: 1,
  voSrc: null,
};

// The app section is timed for an intro whose hologram ends at 10.5 s.
export const HOLO_END_PLANNED = 10.5;
export const TOTAL = 118;

export type Cam = { t: number; x: number; y: number; z: number };
export type Tap = { t: number; x: number; y: number };
export type Enter = "settle" | "slide" | "rise" | "fade" | "cut";

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
  crops?: { y: number; h: number; top: number; delay?: number }[];
  // Covers the capture agent's cursor, in the local background colour.
  masks?: { x: number; y: number; w: number; h: number; color: string }[];
  enter: Enter;
};

type TapRow = { file: string; label: string; t: number; x: number; y: number };
const TAPS = (taps as { taps: TapRow[] }).taps;
const tapAt = (file: string, label: string, fallback: TapRow) =>
  TAPS.find((r) => r.file === file && r.label.startsWith(label)) ?? fallback;

// Shade slider: the clip window follows the logged drag, so a recapture moves it.
const dragStart = tapAt("beat04-hero.mp4", "Hour slider drag start", {
  file: "", label: "", t: 43.4, x: 346, y: 809,
});
const dragEnd = tapAt("beat04-hero.mp4", "Hour slider drag end", {
  file: "", label: "", t: 49.63, x: 380, y: 809,
});
const SLIDER_FROM = 30.2;
const SLIDER_TO = 34.2;
const sliderStart = dragStart.t - 0.5;
const sliderRate = (dragEnd.t + 0.4 - sliderStart) / (SLIDER_TO - SLIDER_FROM);

export const SHOTS: Shot[] = [
  {
    id: "board", from: 10.5, to: 20, still: "beat03-still-board.png", enter: "settle",
    cam: [
      { t: 0, x: 215, y: 330, z: 1.0 },
      { t: 3.8, x: 215, y: 330, z: 1.0 },
      { t: 5.0, x: 215, y: 640, z: 1.1 },
      { t: 8.4, x: 215, y: 640, z: 1.1 },
      { t: 9.0, x: 215, y: 330, z: 1.1 },
    ],
    taps: [{ t: 9.1, x: 215, y: 300 }],
  },
  {
    id: "hero-header", from: 20, to: 25.6, still: "beat04-still-hero-top.png", enter: "slide",
    cam: [
      { t: 0, x: 215, y: 300, z: 1.0 },
      { t: 1.4, x: 212, y: 190, z: 1.1 },
    ],
  },
  {
    id: "hero-roof", from: 25.6, to: SLIDER_FROM, still: "beat04-still-hero-top.png", enter: "cut",
    cam: [
      { t: 0, x: 215, y: 500, z: 1.1 },
      { t: 4.6, x: 200, y: 500, z: 1.35 },
    ],
  },
  {
    id: "hero-shade", from: SLIDER_FROM, to: SLIDER_TO, enter: "fade",
    clip: { file: "beat04-hero.mp4", start: sliderStart, rate: sliderRate },
    cam: [{ t: 0, x: 215, y: dragStart.y - 130, z: 1.12 }],
    taps: [{ t: 0.5 / sliderRate, x: dragStart.x, y: dragStart.y }],
  },
  {
    id: "hero-shade-17", from: SLIDER_TO, to: 38, still: "beat04-still-shading-17h.png", enter: "fade",
    cam: [
      { t: 0, x: 215, y: 600, z: 1.0 },
      { t: 1.2, x: 215, y: 640, z: 1.1 },
    ],
  },
  {
    id: "panels", from: 38, to: 44, still: "beat05-still-panels-why.png", enter: "slide",
    cam: [
      { t: 0, x: 215, y: 480, z: 1.0 },
      { t: 2.0, x: 215, y: 480, z: 1.0 },
      { t: 3.2, x: 200, y: 650, z: 1.12 },
    ],
  },
  {
    id: "battery", from: 44, to: 48.5, still: "beat05-still-battery.png", enter: "fade",
    cam: [
      // The capture cursor sits on the map at y 283 to 305: keep it out of frame.
      { t: 0, x: 215, y: 580, z: 1.0 },
      { t: 1.0, x: 215, y: 570, z: 1.1 },
    ],
    taps: [{ t: 0.15, x: 188, y: 406 }],
  },
  {
    id: "wallbox", from: 48.5, to: 53.5, still: "beat05-still-wallbox.png", enter: "fade",
    cam: [
      { t: 0, x: 215, y: 580, z: 1.0 },
      { t: 1.0, x: 215, y: 560, z: 1.1 },
    ],
    taps: [{ t: 0.15, x: 250, y: 358 }],
  },
  {
    id: "heatpump", from: 53.5, to: 58, still: "beat05-still-heatpump-390.png", cssW: 390, enter: "fade",
    cam: [
      { t: 0, x: 195, y: 560, z: 1.0 },
      { t: 1.0, x: 195, y: 640, z: 1.12 },
    ],
    taps: [{ t: 0.15, x: 331, y: 703 }],
  },
  {
    id: "design", from: 58, to: 63.5, still: "beat06-still-expanded.png", enter: "rise",
    cam: [
      { t: 0, x: 215, y: 330, z: 1.0 },
      { t: 1.6, x: 215, y: 470, z: 1.1 },
    ],
  },
  {
    id: "variants", from: 63.5, to: 69, still: "beat06-still-variants.png", enter: "slide",
    cam: [
      { t: 0, x: 215, y: 560, z: 1.0 },
      { t: 5.5, x: 215, y: 620, z: 1.06 },
    ],
  },
  // Test lead: keep the stale planner header line (y 116 to 190) out of frame.
  {
    id: "kit-wallbox", from: 69, to: 73, still: "beat07-still-wallbox.png", enter: "slide",
    cam: [
      { t: 0, x: 215, y: 700, z: 1.0 },
      { t: 1.2, x: 215, y: 780, z: 1.15 },
    ],
    taps: [{ t: 0.2, x: 316, y: 807 }],
  },
  {
    id: "kit-chooser", from: 73, to: 78, still: "beat07-still-chooser.png", enter: "fade",
    cam: [
      { t: 0, x: 215, y: 420, z: 1.0 },
      { t: 1.4, x: 222, y: 430, z: 1.05 },
    ],
    taps: [{ t: 3.9, x: 222, y: 541 }],
  },
  {
    id: "kit-after", from: 78, to: 84, still: "beat07-still-after-change.png", enter: "fade",
    cam: [
      { t: 0, x: 215, y: 430, z: 1.0 },
      { t: 1.0, x: 222, y: 400, z: 1.06 },
    ],
  },
  {
    id: "approve", from: 84, to: 87.5, still: "beat08-still-approved.png", enter: "slide", cam: [],
    crops: [
      { y: 55, h: 100, top: 60 },
      { y: 280, h: 350, top: 380, delay: 0.25 },
    ],
  },
  {
    id: "sign", from: 87.5, to: 91.5, still: "beat09-still-ready-to-sign.png", enter: "slide",
    cam: [
      { t: 0, x: 215, y: 260, z: 1.0 },
      { t: 1.4, x: 215, y: 620, z: 1.0 },
    ],
    taps: [
      { t: 1.9, x: 43, y: 672 },
      { t: 3.0, x: 215, y: 753 },
    ],
  },
  {
    id: "signed-home", from: 91.5, to: 94.3, still: "beat09-still-signed.png", enter: "fade", cam: [],
    crops: [{ y: 712, h: 122, top: 480 }],
  },
  {
    id: "signed-planner", from: 94.3, to: 97, still: "beat09b-still-signed-kit.png", enter: "slide", cam: [],
    crops: [
      { y: 55, h: 100, top: 60 },
      { y: 280, h: 350, top: 380, delay: 0.25 },
    ],
  },
  {
    id: "check", from: 97, to: 106.2, still: "beat10-still-top.png", enter: "slide",
    cam: [
      { t: 0, x: 215, y: 330, z: 1.0 },
      { t: 1.2, x: 215, y: 290, z: 1.08 },
      { t: 5.6, x: 215, y: 290, z: 1.08 },
      { t: 6.8, x: 215, y: 400, z: 1.08 },
    ],
  },
  {
    id: "heldout", from: 106.2, to: 113, still: "beat10-still-heldout.png", enter: "slide",
    cam: [
      { t: 0, x: 215, y: 280, z: 1.0 },
      { t: 6.8, x: 215, y: 275, z: 1.08 },
    ],
  },
];

export type Caption = { from: number; to: number; text: string };

// Sentence-level, on the planned VO timings (about 2.3 words a second).
export const CAPTIONS: Caption[] = [
  { from: 4.2, to: 7.6, text: "A planner sizes panels, battery, wallbox and heat pump by hand," },
  { from: 7.8, to: 9.9, text: "then writes the offer." },
  { from: 12.0, to: 14.4, text: "Leads land on the board sorted." },
  { from: 14.6, to: 18.8, text: "Priority, Call first or Decline, each with its reason." },
  { from: 20.2, to: 25.5, text: "Katrin Huber is Priority: her roof fits 10.35 kWp and pays back in 10 years." },
  { from: 25.9, to: 29.9, text: "Her real house, from Bavarian 3D data and the aerial photo," },
  { from: 30.2, to: 34.4, text: "with shade worked out panel by panel: 0.6 %." },
  { from: 38.2, to: 39.9, text: "Four decisions in a chain." },
  { from: 40.1, to: 43.9, text: "Panels: 23 modules, sized for her use plus the car." },
  { from: 44.4, to: 46.6, text: "Battery: 10 kWh." },
  { from: 48.9, to: 52.8, text: "Wallbox: 11 kW, for 12,000 km a year." },
  { from: 53.8, to: 57.8, text: "Heat pump: none. The heating facts are not asked yet." },
  { from: 58.3, to: 63.3, text: "The Proposed Design adds it up: €15,820, an estimate, break-even in 10 years." },
  { from: 63.7, to: 68.6, text: "The planners' pick sits next to cheaper and bigger alternatives." },
  { from: 69.3, to: 72.9, text: "A new lead with no electric car gets no wallbox." },
  { from: 73.3, to: 77.4, text: "The planner moves the battery from 5 to 10 kWh." },
  { from: 78.2, to: 83.8, text: "The design follows: €9,470 becomes €11,050, autarky 78 % becomes 85 %." },
  { from: 84.3, to: 86.6, text: "The planner approves." },
  { from: 87.7, to: 91.4, text: "The homeowner sees that design, as an estimate, and signs." },
  { from: 91.7, to: 94.2, text: "Enquiry to signature: 2 min 19 s." },
  { from: 94.5, to: 96.8, text: "The planner sees it Signed." },
  { from: 97.3, to: 102.3, text: "Then the check: 633 sealed signed homes the rules never saw, scored once." },
  { from: 102.6, to: 108.6, text: "All four parts within tolerance at once: Marquee's draft 18.6 %, the textbook rule 6.8 %." },
  { from: 109.0, to: 112.6, text: "One held-out home: three parts within, solar missed." },
];

export type Pop = { from: number; to: number; value: string; label: string };

export const POPS: Pop[] = [
  { from: 21.6, to: 24.4, value: "10.35 kWp", label: "fits the roof" },
  { from: 34.2, to: 37.0, value: "0.6 %", label: "lost to shade, 59 kWh a year" },
  { from: 40.6, to: 43.4, value: "23 modules", label: "10.35 kWp, her use plus the car" },
  { from: 44.6, to: 47.4, value: "10 kWh", label: "battery" },
  { from: 49.3, to: 52.1, value: "11 kW", label: "wallbox, 12,000 km a year" },
  { from: 59.8, to: 62.6, value: "€15,820", label: "estimate, autarky 64 %, break-even 10 years" },
  { from: 78.6, to: 81.2, value: "€11,050", label: "estimate, was €9,470" },
  { from: 81.3, to: 83.9, value: "85 %", label: "autarky, was 78 %. Break-even 13 years, was 12" },
  { from: 92.0, to: 94.3, value: "2 min 19 s", label: "enquiry to signature, this run" },
  { from: 98.4, to: 101.2, value: "633", label: "sealed held-out signed homes" },
  { from: 104.6, to: 107.4, value: "18.6 %", label: "Marquee draft, all four parts within. Textbook rule 6.8 %" },
];

export const CLOSE_FROM = 113;
export const CLOSE = {
  name: "Marquee",
  url: "marquee-reonic.vercel.app",
  team: "Xander, Zi Yuan, Jamon",
};
