import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { INK, MONO, PAPER, SANS, SERIF } from "../theme";
import {
  CAPTIONS,
  CLOSE,
  CLOSE_FROM,
  CSS_H,
  CSS_W,
  Cam,
  FPS,
  HOLO_END_PLANNED,
  LABELS,
  LaunchProps,
  POPS,
  SHOTS,
  Shot,
  TOTAL,
  VIEW_H,
  W,
  H,
  sec,
} from "./config";

const BLUE = "#0D1BFE";
const GREY = "#4A4C55";
const LABEL_GREY = "#8A8B92";
const HAIR = "rgb(10 12 20 / .14)";

// Springs with no bounce, about 300 ms.
const ease = (frame: number, fps: number, dur = 9) =>
  spring({ frame, fps, config: { damping: 200, mass: 0.6 }, durationInFrames: dur });

const smooth = Easing.inOut(Easing.cubic);

// Shift of everything after the intro when the hologram take is longer or shorter.
export const appShift = (p: LaunchProps) => p.hologram.start + p.hologram.len - HOLO_END_PLANNED;
export const launchDuration = (p: LaunchProps) => sec(TOTAL + appShift(p));

function camAt(cam: Cam[], t: number): Cam {
  if (t <= cam[0].t) return cam[0];
  for (let i = 1; i < cam.length; i++) {
    const a = cam[i - 1];
    const b = cam[i];
    if (t <= b.t) {
      const k = smooth((t - a.t) / (b.t - a.t));
      return { t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
    }
  }
  return cam[cam.length - 1];
}

// Maps capture CSS px to frame px for a camera, clamped so the screen never runs out.
function project(c: Cam, cw = CSS_W) {
  const ch = (cw * CSS_H) / CSS_W;
  const s = (W / cw) * c.z;
  const vw = W / s;
  const vh = VIEW_H / s;
  const x = Math.min(Math.max(c.x, vw / 2), cw - vw / 2);
  const y = vh >= ch ? ch / 2 : Math.min(Math.max(c.y, vh / 2), ch - vh / 2);
  return { s, left: W / 2 - x * s, top: VIEW_H / 2 - y * s };
}

const TapMark: React.FC<{ t: number; x: number; y: number; cam: Cam[]; cw: number }> = ({ t, x, y, cam, cw }) => {
  const frame = useCurrentFrame();
  const local = frame / FPS - t;
  if (local < 0 || local > 0.6) return null;
  const { s, left, top } = project(camAt(cam, frame / FPS), cw);
  const px = left + x * s;
  const py = top + y * s;
  const k = Easing.out(Easing.cubic)(local / 0.6);
  const d = 52 + 70 * k;
  const dot = interpolate(local, [0, 0.35], [0.85, 0], { extrapolateRight: "clamp" });
  return (
    <>
      <div style={{ position: "absolute", left: px - d / 2, top: py - d / 2, width: d, height: d, borderRadius: "50%", border: `4px solid ${BLUE}`, opacity: 1 - k }} />
      <div style={{ position: "absolute", left: px - 13, top: py - 13, width: 26, height: 26, borderRadius: "50%", background: BLUE, opacity: dot }} />
    </>
  );
};

const ShotView: React.FC<{ shot: Shot }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = shot.enter === "cut" ? 1 : ease(frame, fps, shot.enter === "settle" ? 18 : shot.enter === "crossfade" ? 30 : 10);
  const cw = shot.cssW ?? CSS_W;
  const ch = (cw * CSS_H) / CSS_W;
  const enterStyle: React.CSSProperties =
    shot.enter === "slide"
      ? { transform: `translateX(${(1 - p) * W}px)` }
      : shot.enter === "rise"
        ? { transform: `translateY(${(1 - p) * VIEW_H}px)` }
        : shot.enter === "settle"
          ? { opacity: p, transform: `scale(${0.96 + 0.04 * p})` }
          : shot.enter === "fade" || shot.enter === "crossfade"
            ? { opacity: p }
            : {};
  if (shot.crops && shot.still) {
    const s = W / cw;
    const src = staticFile(`capture/${shot.still}`);
    return (
      <AbsoluteFill style={{ height: VIEW_H, overflow: "hidden", background: PAPER, ...enterStyle }}>
        {shot.crops.map((c, i) => {
          const k = ease(frame - sec(c.delay ?? 0), fps, 10);
          return (
            <div key={i} style={{ position: "absolute", left: 0, width: W, top: c.top, height: c.h * s, overflow: "hidden", opacity: k, transform: `translateY(${(1 - k) * 30}px)`, borderTop: `2px solid ${HAIR}`, borderBottom: `2px solid ${HAIR}` }}>
              <Img src={src} style={{ position: "absolute", left: 0, top: -c.y * s, width: W, height: ch * s }} />
            </div>
          );
        })}
      </AbsoluteFill>
    );
  }
  const { s, left, top } = project(camAt(shot.cam, frame / FPS), cw);
  const box: React.CSSProperties = { position: "absolute", left, top, width: cw * s, height: ch * s };
  return (
    <AbsoluteFill style={{ height: VIEW_H, overflow: "hidden", background: PAPER, ...enterStyle }}>
      {shot.still ? (
        <div style={box}>
          <Img src={staticFile(`capture/${shot.still}`)} style={{ width: "100%", height: "100%" }} />
          {(shot.masks ?? []).map((m, i) => (
            <div key={i} style={{ position: "absolute", left: m.x * s, top: m.y * s, width: m.w * s, height: m.h * s, background: m.color }} />
          ))}
        </div>
      ) : shot.clip ? (
        <OffthreadVideo
          src={staticFile(`capture/${shot.clip.file}`)}
          trimBefore={Math.round(shot.clip.start * FPS)}
          playbackRate={shot.clip.rate}
          muted
          style={box}
        />
      ) : null}
      {(shot.taps ?? []).map((t, i) => (
        <TapMark key={i} {...t} cam={shot.cam} cw={cw} />
      ))}
    </AbsoluteFill>
  );
};

const PopView: React.FC<{ value: string; label: string; len: number }> = ({ value, label, len }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = ease(frame, fps, 10);
  const out = interpolate(frame, [len - 8, len], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 80, right: 80, top: VIEW_H + 46, opacity: p * out, transform: `translateY(${(1 - p) * 24}px)` }}>
      <div style={{ fontFamily: SERIF, fontSize: 210, lineHeight: 1, color: BLUE, letterSpacing: -2 }}>{value}</div>
      <div style={{ fontFamily: MONO, fontSize: 30, color: GREY, marginTop: 14 }}>{label}</div>
    </div>
  );
};

const CaptionView: React.FC<{ text: string; len: number; overVideo: boolean }> = ({ text, len, overVideo }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 6, len - 6, len], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 80, right: 80, top: 1640, opacity: o, display: "flex" }}>
      <div
        style={{
          fontFamily: SANS,
          fontWeight: 500,
          fontSize: 50,
          lineHeight: 1.24,
          color: INK,
          background: overVideo ? PAPER : "transparent",
          padding: overVideo ? "14px 22px" : 0,
        }}
      >
        {text}
      </div>
    </div>
  );
};

const Intro: React.FC<{ p: LaunchProps }> = ({ p }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const h = p.hologram;
  const end = h.start + h.len;
  // Slow push into the hologram, then the room gives way to paper.
  const push = interpolate(t, [h.pushStart, end + 0.3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.sin) });
  const paper = interpolate(t, [end - 0.7, end + 0.2], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.quad) });
  const scale = 1 + 0.75 * push;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ opacity: 1 - paper, transform: `scale(${scale})`, transformOrigin: `${h.focusX * 100}% ${h.focusY * 100}%` }}>
        {p.introRawEnd > 0 ? (
          <Sequence durationInFrames={sec(p.introRawEnd)}>
            <OffthreadVideo src={staticFile(p.intro)} trimBefore={Math.round(p.introFrom * FPS)} muted style={{ width: W, height: H, objectFit: "cover" }} />
          </Sequence>
        ) : null}
        <Sequence from={sec(h.start)} durationInFrames={sec(h.len)}>
          <OffthreadVideo src={staticFile(h.src)} trimBefore={Math.round(h.from * FPS)} playbackRate={h.rate} muted style={{ width: W, height: H, objectFit: "cover" }} />
        </Sequence>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// Beat label: fades out while a number pop is up, back in once it has gone.
const BeatLabels: React.FC<{ shift: number }> = ({ shift }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS - shift;
  const label = LABELS.find((l) => t >= l.from && t < l.to);
  if (!label) return null;
  const ramp = 0.3;
  const popVis = Math.max(0, ...POPS.map((p) => Math.min(
    interpolate(t, [p.from - ramp, p.from], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    interpolate(t, [p.to, p.to + ramp], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
  )));
  const edge = Math.min(
    interpolate(t, [label.from, label.from + ramp], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    interpolate(t, [label.to - ramp, label.to], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
  );
  return (
    <div style={{ position: "absolute", left: 80, top: VIEW_H + 64, opacity: edge * (1 - popVis), fontFamily: MONO, fontWeight: 500, fontSize: 30, letterSpacing: 6, textTransform: "uppercase", color: LABEL_GREY }}>
      {label.text}
    </div>
  );
};

const CloseCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bg = ease(frame, fps, 10);
  const item = (i: number) => {
    const k = ease(frame - 6 - i * 5, fps, 10);
    return { opacity: k, transform: `translateY(${(1 - k) * 18}px)` };
  };
  return (
    <AbsoluteFill style={{ background: PAPER, opacity: bg, padding: "0 90px", justifyContent: "center" }}>
      <div style={{ ...item(0), fontFamily: SERIF, fontSize: 210, lineHeight: 1, color: INK }}>{CLOSE.name}</div>
      <div style={{ ...item(1), fontFamily: MONO, fontSize: 40, color: BLUE, marginTop: 34 }}>{CLOSE.url}</div>
      <div style={{ height: 2, background: HAIR, margin: "72px 0 40px", ...item(2) }} />
      <div style={{ ...item(2), fontFamily: SANS, fontSize: 40, color: GREY, marginTop: 0 }}>{CLOSE.team}</div>
    </AbsoluteFill>
  );
};

export const Launch: React.FC<LaunchProps> = (p) => {
  const shift = appShift(p);
  const introEnd = p.hologram.start + p.hologram.len;
  const at = (s: number) => sec(s + (s >= HOLO_END_PLANNED ? shift : 0));
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      {/* Paper zone rule under the screen */}
      <div style={{ position: "absolute", left: 0, right: 0, top: VIEW_H, height: 2, background: HAIR }} />

      <Sequence durationInFrames={sec(introEnd + 0.4)} name="intro">
        <Intro p={p} />
      </Sequence>

      {SHOTS.map((shot) => {
        const from = at(shot.from);
        const len = at(shot.to) - from + 12;
        return (
          <Sequence key={shot.id} from={from} durationInFrames={len} name={shot.id}>
            <ShotView shot={shot} />
          </Sequence>
        );
      })}

      <BeatLabels shift={shift} />

      {POPS.map((pop, i) => (
        <Sequence key={`pop${i}`} from={at(pop.from)} durationInFrames={at(pop.to) - at(pop.from)} name={`pop ${pop.value}`}>
          <PopView value={pop.value} label={pop.label} len={at(pop.to) - at(pop.from)} />
        </Sequence>
      ))}

      {p.captions && CAPTIONS.map((c, i) => (
        <Sequence key={`cap${i}`} from={at(c.from)} durationInFrames={at(c.to) - at(c.from)} name={`cap ${i}`}>
          <CaptionView text={c.text} len={at(c.to) - at(c.from)} overVideo={c.to <= introEnd} />
        </Sequence>
      ))}

      <Sequence from={at(CLOSE_FROM)} name="close">
        <CloseCard />
      </Sequence>

      {p.roomSound ? (
      <Sequence durationInFrames={sec(introEnd + 0.5)} name="room sound">
        <Audio src={staticFile(p.roomSound.src)} trimBefore={Math.round(p.roomSound.from * FPS)} volume={(f) => interpolate(f, [0, sec(introEnd - 1), sec(introEnd + 0.3)], [0.6, 0.6, 0], { extrapolateRight: "clamp" })} />
      </Sequence>
      ) : null}
      {p.musicSrc ? <Audio src={staticFile(p.musicSrc)} volume={p.musicVolume} /> : null}
      {p.voSrc ? <Audio src={staticFile(p.voSrc)} /> : null}
    </AbsoluteFill>
  );
};
