"use client";
// The photo mesh option: in 3D, Google Photorealistic 3D Tiles replace the LoD2 house under our layout, in the same
// scene. Off by default: the Bavarian LoD2 model is the 3D view, and nothing reaches Google (status call, tiles)
// until the planner picks "Photo mesh" on the layers menu (meshPref.ts, remembered for the session).
// usePhoto(origin, scene, active, opts) → { available, on, setOn, overlay, under }.
// While the house sharpens: the last picture of this view (snapshot.ts) stands in, "Sharpening the house" shows,
// and panels and labels wait; once sharp, the picture cross-fades to the live scene and a new one is kept.
// The LoD2 scene and toolbar never depend on anything here: this hook runs only after the scene is up, every step
// is contained (try/catch, promise catch, WebGL context loss, 6 s watchdog) and a failure switches the option off
// with the reason on the layers menu. The LoD2 model stays when the server has no key, the root tileset fails, the
// house has no origin, the device's WebGL is too weak, the GPU drops the context, or the mesh is not up within 6 s.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SpatialScene } from "./scene";
import type { PhotoLayer, Profile } from "./tiles";
import type { RoofPlane } from "./types";
import { anchorOf, isOrigin } from "@/lib/tilesGeo";
import { meshOff, setMeshWanted, useMeshPref } from "./meshPref";
import { loadSnap, saveSnap, snapshotOf } from "./snapshot";

type Status = { mode: "google" | "off"; root?: string; error?: string };

const chip = (bottom: number): React.CSSProperties => ({
  position: "absolute", left: 12, bottom, zIndex: 2, maxWidth: "calc(100% - 140px)", margin: 0,
  fontSize: 10, lineHeight: 1.3, color: "var(--ink-2)", background: "rgba(253, 253, 251, 0.85)", padding: "1px 6px",
  borderRadius: 6, pointerEvents: "none",
});

const msg = (why: unknown) => (why instanceof Error ? why.message : String(why));
const off = (why: unknown) => console.warn(`Mesh view off: ${msg(why)}`);

// Tile budget per device: iOS, iPadOS and visionOS Safari get a smaller cache and a coarser far field, never the
// drawing; desktop Safari shares that budget, the small screen gets the tightest.
function profileOf(): Profile {
  const ua = navigator.userAgent, touch = navigator.maxTouchPoints > 1;
  if (window.matchMedia("(max-width: 640px)").matches) return "phone";
  const apple = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch); // iPadOS and visionOS report a Mac
  const safari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
  return apple || touch || safari ? "touch" : "desktop";
}

export function usePhoto(origin: unknown, scene: SpatialScene | null, active: boolean, opts: { creditBottom?: number; planes?: RoofPlane[]; snapKey?: string } = {}): {
  available: boolean; on: boolean; setOn: (on: boolean) => void; overlay: ReactNode; under: ReactNode;
} {
  const on = useMeshPref().want;
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(false);
  const [sharp, setSharp] = useState(false);
  const [text, setText] = useState("");
  const [snap, setSnap] = useState<string | null>(null);
  const [snapGone, setSnapGone] = useState(false);
  const layer = useRef<PhotoLayer | null>(null);
  const o = isOrigin(origin) ? origin : null;
  const oKey = o ? o.join(",") : "";
  const wanted = on && active && !!o;
  const planes = useRef<RoofPlane[]>([]);
  planes.current = opts.planes ?? [];

  useEffect(() => { setStatus(null); }, [oKey]);
  useEffect(() => { if (on) setFailed(false); }, [on]);

  // The status call warms the house's tiles on the server, so it waits for the planner's pick too.
  useEffect(() => {
    if (!wanted || status) return;
    const ac = new AbortController();
    fetch(`/api/tiles/status?o=${encodeURIComponent(oKey)}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((s: Status) => { setStatus(s); if (s.mode !== "google" || !s.root) meshOff(`Photo 3D unavailable: ${s.error ?? "no tiles here"}`); })
      .catch((e) => { if ((e as Error).name !== "AbortError") meshOff(`Photo 3D unavailable: ${msg(e)}`); });
    return () => ac.abort();
  }, [wanted, status, oKey]);

  // The last settled picture of this view, as the first frame.
  useEffect(() => {
    setSnap(null); setSnapGone(false);
    if (!wanted || !opts.snapKey) return;
    const ac = new AbortController();
    loadSnap(opts.snapKey, ac.signal).then((u) => { if (!ac.signal.aborted) setSnap(u); });
    return () => ac.abort();
  }, [wanted, opts.snapKey]);

  const [capable, setCapable] = useState<boolean | null>(null);
  useEffect(() => {
    if (!scene || !wanted || capable !== null) return;
    let dead = false;
    import("./tiles")
      .then(({ photoCapable }) => {
        if (dead) return;
        const ok = photoCapable(scene);
        setCapable(ok);
        if (!ok) meshOff("Photo 3D unavailable: this device's graphics are too limited");
      })
      .catch((e) => { off(e); if (!dead) { setCapable(false); meshOff(`Photo 3D off: ${msg(e)}`); } });
    return () => { dead = true; };
  }, [scene, wanted, capable]);

  const available = !!o && !!status && status.mode === "google" && !!status.root && capable === true && !failed;
  const live = available && wanted && !!scene;

  useEffect(() => {
    if (!live || !scene || !o || !status?.root) return;
    let dead = false;
    const fail = (e: unknown) => { if (dead) return; off(e); setFailed(true); meshOff(`Photo 3D off: ${msg(e)}`); };
    import("./tiles").then(({ PhotoLayer }) => {
      if (dead) return;
      try {
        layer.current = new PhotoLayer(scene, {
          root: status.root!, anchor: anchorOf(o), profile: profileOf(), planes: planes.current,
          onReady: () => { if (!dead) setShown(true); },
          onSharp: () => { if (!dead) setSharp(true); },
          onFail: fail,
          onCredit: (t) => { if (!dead) setText(t); },
        });
      } catch (e) { fail(e); }
    }).catch(fail);
    return () => {
      dead = true;
      try { layer.current?.dispose(); } catch (e) { off(e); }
      layer.current = null; setShown(false); setSharp(false); setText("");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, scene, status, oKey]);

  // Watchdog: whatever stalls (chunk, tiles, fit), no mesh within 6 s of picking it and the LoD2 model stays.
  useEffect(() => {
    if (!live || shown) return;
    const t = setTimeout(() => { off("no mesh within 6 s"); setFailed(true); meshOff("Photo 3D off: the tiles took too long"); }, 6000);
    return () => clearTimeout(t);
  }, [live, shown]);

  // Sharp and settled: keep this view as the next first frame.
  useEffect(() => {
    if (!sharp || !scene || !opts.snapKey) return;
    const key = opts.snapKey;
    const t = setTimeout(() => { const u = snapshotOf(scene); if (u) saveSnap(key, u); }, 900);
    return () => clearTimeout(t);
  }, [sharp, scene, opts.snapKey]);

  const cb = opts.creditBottom ?? 22;
  const sharpening = wanted && !failed && !sharp;
  const overlay = (
    <>
      {live && shown && <p style={chip(cb)}>{["Google", ...text.split("; ").filter((x) => x && x !== "Google")].join(", ")}</p>}
      {sharpening && <p style={chip(cb + 20)} aria-live="polite">Sharpening the house</p>}
    </>
  );
  const under = wanted && !failed && snap && !snapGone ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={snap} alt="" aria-hidden="true" onTransitionEnd={() => { if (sharp) setSnapGone(true); }}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none", opacity: sharp ? 0 : 1, transition: "opacity 400ms ease-out" }} />
  ) : null;

  return { available, on: live && shown, setOn: setMeshWanted, overlay, under };
}
