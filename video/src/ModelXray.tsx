import React, { useEffect, useMemo, useState } from "react";
import { AbsoluteFill, cancelRender, continueRender, delayRender, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import home from "../data/home.json";
import { labelFor } from "./home";
import { parsePlanes, toGl, type ModelData, type V3 } from "./modelPlanes";
import { H, W } from "./timeline";
import { BLUE, INK, MONO, PAPER, PAPER_2, SANS } from "./theme";
import type { AnchorId } from "./anchors";

const FOV = 32;
// Label anchors in local metres (x east, y north, z up). Edit once the house is known.
const ANCHORS_3D: Record<Exclude<AnchorId, "pv">, V3> = {
  battery: [2.5, -6.5, 1.6],
  heatpump: [7.5, 0, 0.6],
  wallbox: [-3, -6.5, 1.3],
};
const LABEL_AT: Record<AnchorId, { at: [number, number]; side: "left" | "right" }> = {
  pv: { at: [0.7, 0.14], side: "right" },
  battery: { at: [0.2, 0.62], side: "left" },
  heatpump: { at: [0.72, 0.62], side: "right" },
  wallbox: { at: [0.72, 0.8], side: "right" },
};

const useOrbit = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 300 });
  const az = THREE.MathUtils.degToRad(-30 + 60 * p);
  const el = THREE.MathUtils.degToRad(34);
  const dist = 52;
  return { az, el, dist };
};
const camPos = (c: V3, o: { az: number; el: number; dist: number }) =>
  new THREE.Vector3(c[0] + o.dist * Math.cos(o.el) * Math.sin(o.az), c[1] + o.dist * Math.sin(o.el), c[2] + o.dist * Math.cos(o.el) * Math.cos(o.az));

const Rig: React.FC<{ target: V3 }> = ({ target }) => {
  const o = useOrbit();
  const camera = useThree((s) => s.camera);
  camera.position.copy(camPos(target, o));
  camera.lookAt(...target);
  camera.updateMatrixWorld();
  return null;
};

const PanelMesh: React.FC<{ p: V3[] }> = ({ p }) => {
  const [fill, line] = useMemo(() => {
    const v = p.map((q) => new THREE.Vector3(...toGl(q as V3)));
    const n = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[3], v[0])).normalize();
    if (n.y < 0) n.negate();
    const w = v.map((x) => x.clone().addScaledVector(n, 0.06));
    const g = new THREE.BufferGeometry().setFromPoints([w[0], w[1], w[2], w[0], w[2], w[3]]);
    const l = new THREE.BufferGeometry().setFromPoints(w);
    return [g, l];
  }, [p]);
  return (
    <>
      <mesh geometry={fill}>
        <meshBasicMaterial color={BLUE} side={THREE.DoubleSide} />
      </mesh>
      <lineLoop geometry={line}>
        <lineBasicMaterial color={PAPER} />
      </lineLoop>
    </>
  );
};

const Labels: React.FC<{ data: ModelData }> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = useOrbit();
  const target = toGl(data.centre);
  const cam = useMemo(() => new THREE.PerspectiveCamera(FOV, W / H, 0.1, 500), []);
  cam.position.copy(camPos(target as V3, o));
  cam.lookAt(...(target as V3));
  cam.updateMatrixWorld();
  const proj = (p: V3) => {
    const v = new THREE.Vector3(...toGl(p)).project(cam);
    return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H] as [number, number];
  };
  const pvC: V3 = data.panels.length
    ? (data.panels.flat().reduce((t, q) => [t[0] + q[0], t[1] + q[1], t[2] + q[2]], [0, 0, 0]).map((s) => s / (data.panels.length * 4)) as V3)
    : data.centre;
  const ids: AnchorId[] = ["pv", "battery", "heatpump", "wallbox"];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0 }}>
      {ids.map((id, i) => {
        const a = id === "pv" ? pvC : ANCHORS_3D[id];
        const [cx, cy] = proj(a);
        const label = labelFor(id);
        const p = spring({ frame: frame - 20 - i * 30, fps, config: { damping: 200 }, durationInFrames: 45 });
        const boxW = Math.max(label.value.length * 26 + 36, label.name.length * 17 + 36);
        const ex = LABEL_AT[id].at[0] * W;
        const ey = LABEL_AT[id].at[1] * H;
        const dir = LABEL_AT[id].side === "right" ? 1 : -1;
        const bx = dir === 1 ? ex : ex - boxW;
        const d = `M${cx} ${cy} L${ex - dir * 48} ${ey} L${ex} ${ey}`;
        return (
          <g key={id}>
            <path d={d} pathLength={1} fill="none" stroke={PAPER} strokeWidth={2} strokeDasharray={1} strokeDashoffset={1 - p} />
            <rect x={cx - 6} y={cy - 6} width={12} height={12} fill={PAPER} opacity={p} />
            <g opacity={p}>
              <rect x={bx} y={ey - 46} width={boxW} height={92} fill={PAPER} />
              <text x={bx + 18} y={ey - 10} fontFamily={MONO} fontSize={20} letterSpacing="0.14em" fill={INK}>{label.name}</text>
              <text x={bx + 18} y={ey + 28} fontFamily={MONO} fontSize={38} fontWeight={500} fill={INK}>{label.value}</text>
            </g>
          </g>
        );
      })}
    </svg>
  );
};

const Missing: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: INK, justifyContent: "center", paddingLeft: 160 }}>
    <div style={{ fontFamily: MONO, fontSize: 28, letterSpacing: "0.14em", color: PAPER }}>MODEL NOT YET DELIVERED</div>
  </AbsoluteFill>
);

export const ModelXray: React.FC = () => {
  const [state, setState] = useState<{ gltf: THREE.Group; data: ModelData } | "missing" | null>(null);
  const [handle] = useState(() => delayRender("model"));
  useEffect(() => {
    (async () => {
      try {
        const pr = await fetch(staticFile("model/planes.json"));
        const gr = await fetch(staticFile("model/house.glb"));
        if (!pr.ok || !gr.ok) throw new Error("missing");
        const json = await pr.json();
        const buf = await gr.arrayBuffer();
        const gltf = await new GLTFLoader().parseAsync(buf, "");
        gltf.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            const old = m.material as THREE.MeshStandardMaterial;
            m.material = new THREE.MeshBasicMaterial({ map: old.map ?? null, color: old.map ? 0xffffff : old.color, vertexColors: !!m.geometry.attributes.color, side: THREE.DoubleSide });
          }
        });
        setState({ gltf: gltf.scene, data: parsePlanes(json, home.design.pv_kwp) });
      } catch {
        setState("missing");
      }
      continueRender(handle);
    })().catch((e) => cancelRender(e));
  }, [handle]);

  if (state === null) return null;
  if (state === "missing") return <Missing />;
  const { gltf, data } = state;
  const target = toGl(data.centre);
  return (
    <AbsoluteFill style={{ backgroundColor: INK }}>
      <ThreeCanvas width={W} height={H} camera={{ fov: FOV, near: 0.1, far: 500 }}>
        <Rig target={target as V3} />
        <primitive object={gltf} />
        {data.panels.map((p, i) => (
          <PanelMesh key={i} p={p} />
        ))}
      </ThreeCanvas>
      <Labels data={data} />
      {data.licence && (
        <div style={{ position: "absolute", left: 0, bottom: 0, padding: "10px 64px", background: INK, right: 0, fontFamily: SANS, fontSize: 20, color: PAPER_2 }}>{data.licence}</div>
      )}
    </AbsoluteFill>
  );
};
