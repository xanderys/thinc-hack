// AR intro: a miniature solar house tracked onto the desk in Zi Yuan's take.
// Frame n of this composition is frame n of public/holo/plate.mp4 (source 0.3 s to 10.3 s, 30 fps).
// public/holo/track.json comes from the OpenCV desk track (scratchpad scripts, not in the repo):
// per frame, the camera's world matrix and a projection matrix whose 2D correction pins the
// house footprint to the tracked desk homography, so the base cannot slide.
// public/holo/fg/<n>.png is the plate with alpha = his body, arm or hand where they pass in
// front of the house; it is laid over the render so the house never floats in front of him.
import React, { useEffect, useMemo, useState } from "react";
import { AbsoluteFill, Img, OffthreadVideo, cancelRender, continueRender, delayRender, staticFile, useCurrentFrame } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export const HOLO_FRAMES = 300;
const W = 1080;
const H = 1920;

type Track = {
  house: [number, number, number];
  first: number;
  frames: Record<string, { cam: number[]; proj: number[] }>;
  fg: number[];
  reveal: number;
  lum: Record<string, number>; // desk brightness near the house, 1 at frame 156
};

// Model is 1.0 wide, 0.475 tall, 0.83 deep, centred on the origin.
// The lawn base starts just big enough to cover the sketch paper (about 0.3 x 0.3 units).
const BASE_W = 0.44; // world units (1 unit is about 0.9 m: the can is 0.19)
const MODEL_HALF_H = 0.2381;
// Lawn edges square to the paper's edges.
const YAW0 = THREE.MathUtils.degToRad(-46);

// Expand: hands frame the house 152 to 157, spread 158 to 166; it ends at 2.2x.
const SCALE_KEYS: [number, number][] = [
  [157, 1.0],
  [158, 1.04],
  [159, 1.14],
  [160, 1.32],
  [161, 1.56],
  [162, 1.82],
  [163, 2.04],
  [164, 2.16],
  [166, 2.2],
];
const scaleAt = (f: number) => {
  if (f <= SCALE_KEYS[0][0]) return SCALE_KEYS[0][1];
  for (let i = 1; i < SCALE_KEYS.length; i++) {
    const [f1, v1] = SCALE_KEYS[i];
    const [f0, v0] = SCALE_KEYS[i - 1];
    if (f <= f1) return v0 + ((v1 - v0) * (f - f0)) / (f1 - f0);
  }
  return SCALE_KEYS[SCALE_KEYS.length - 1][1];
};

// Swipe: his right hand sweeps right to left across the house, 188 to 196; the flick lands at 192.
// One fast turn in the first 0.5 s, then exponential decay to a slow 20 deg/s spin.
export const SWIPE = 192;
const W_END = 20; // deg/s
const TAU = 0.35; // s
const W0 = W_END + (360 - W_END * 0.5) / (TAU * (1 - Math.exp(-0.5 / TAU)));
const RAMP = 2 / 30; // the hand takes two frames to get it going
const spinDeg = (f: number) => {
  const t = (f - SWIPE) / 30;
  if (t <= 0) return 0;
  // ease the first two frames so it is pushed, not snapped
  const te = t < RAMP ? (t * t) / (2 * RAMP) : t - RAMP / 2;
  return W_END * te + (W0 - W_END) * TAU * (1 - Math.exp(-te / TAU));
};

const makeTexture = (draw: (c: CanvasRenderingContext2D, s: number) => void, size = 512) => {
  const cv = document.createElement("canvas");
  cv.width = size;
  cv.height = size;
  draw(cv.getContext("2d")!, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

const roundRect = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
};

// Ring texture covers 1.5 x 1.5 model units; the lawn base is 1.0 x 0.83.
const RING_SPAN = 1.5;
const ringTexture = () =>
  makeTexture((c, s) => {
    const k = s / RING_SPAN;
    const bw = 1.0 * k;
    const bh = 0.83 * k;
    const x = (s - bw) / 2;
    const y = (s - bh) / 2;
    c.clearRect(0, 0, s, s);
    for (const [blur, width, alpha] of [
      [60, 26, 0.55],
      [26, 12, 0.8],
      [6, 4, 1.0],
    ] as const) {
      c.save();
      c.shadowColor = `rgba(90,235,255,${alpha})`;
      c.shadowBlur = blur;
      c.strokeStyle = `rgba(150,245,255,${alpha})`;
      c.lineWidth = width;
      roundRect(c, x, y, bw, bh, 0.06 * k);
      c.stroke();
      c.restore();
    }
  });
const shadowTexture = () =>
  makeTexture((c, s) => {
    const k = s / RING_SPAN;
    c.clearRect(0, 0, s, s);
    c.save();
    c.filter = `blur(${0.06 * k}px)`;
    c.fillStyle = "rgba(0,0,0,0.55)";
    roundRect(c, (s - 1.04 * k) / 2, (s - 0.87 * k) / 2, 1.04 * k, 0.87 * k, 0.05 * k);
    c.fill();
    c.restore();
  });

const Rig: React.FC<{ track: Track }> = ({ track }) => {
  const frame = useCurrentFrame();
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const fr = track.frames[String(Math.max(track.first, Math.min(HOLO_FRAMES - 1, frame)))];
  new THREE.Matrix4().fromArray(fr.cam).decompose(camera.position, camera.quaternion, camera.scale);
  camera.updateMatrixWorld(true);
  camera.projectionMatrix.fromArray(fr.proj);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  return null;
};

const House: React.FC<{ track: Track; model: THREE.Group }> = ({ track, model }) => {
  const frame = useCurrentFrame();
  const ring = useMemo(ringTexture, []);
  const shadow = useMemo(shadowTexture, []);
  const s = BASE_W * scaleAt(frame);
  const yaw = YAW0 - THREE.MathUtils.degToRad(spinDeg(frame));
  const [x, y, z] = track.house;
  return (
    <group position={[x, y, z]} rotation={[0, yaw, 0]} scale={[s, s, s]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} renderOrder={1}>
        <planeGeometry args={[RING_SPAN, RING_SPAN]} />
        <meshBasicMaterial map={shadow} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} renderOrder={2}>
        <planeGeometry args={[RING_SPAN, RING_SPAN]} />
        <meshBasicMaterial map={ring} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <primitive object={model} position={[0, MODEL_HALF_H, 0]} />
    </group>
  );
};

const useLoaded = () => {
  const [state, setState] = useState<{ track: Track; model: THREE.Group } | null>(null);
  const [handle] = useState(() => delayRender("holo assets"));
  useEffect(() => {
    (async () => {
      try {
        const track = (await (await fetch(staticFile("holo/track.json"))).json()) as Track;
        const buf = await (await fetch(staticFile("model3d/mini-house.glb"))).arrayBuffer();
        const gltf = await new GLTFLoader().parseAsync(buf, "");
        gltf.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            const mat = m.material as THREE.MeshStandardMaterial;
            mat.roughness = 0.85;
            mat.metalness = 0;
            mat.envMapIntensity = 0;
          }
        });
        setState({ track, model: gltf.scene });
        continueRender(handle);
      } catch (e) {
        cancelRender(e as Error);
      }
    })();
  }, [handle]);
  return state;
};

export const HoloIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const loaded = useLoaded();
  const fg = loaded && loaded.track.fg.includes(frame);
  const show = loaded && frame >= loaded.track.reveal;
  const lum = (loaded && loaded.track.lum[String(frame)]) || 1;
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <OffthreadVideo src={staticFile("holo/plate.mp4")} style={{ width: W, height: H }} />
      {loaded && show ? (
        <ThreeCanvas width={W} height={H} camera={{ manual: true, near: 0.02, far: 30 }} style={{ position: "absolute", inset: 0, filter: "blur(0.6px)" }}>
          <Rig track={loaded.track} />
          <hemisphereLight args={["#fff1df", "#d9c3a8", 1.25 * lum]} />
          <directionalLight color="#ffe3c2" intensity={2.1 * lum} position={[0.6, 3, 0.8]} />
          <directionalLight color="#ffd9b0" intensity={0.5 * lum} position={[-1.5, 1, 2]} />
          <House track={loaded.track} model={loaded.model} />
        </ThreeCanvas>
      ) : null}
      {fg ? <Img src={staticFile(`holo/fg/${frame}.png`)} style={{ position: "absolute", inset: 0, width: W, height: H }} /> : null}
    </AbsoluteFill>
  );
};
