"use client";
// The photo mesh option: in 3D, Google Photorealistic 3D Tiles replace the LoD2 house under our layout, in the same
// scene. Off by default: the Bavarian LoD2 model is the 3D view, and nothing reaches Google (status call, tiles)
// until the planner picks "Photo mesh" on the layers menu (meshPref.ts, remembered for the session).
// usePhoto(origin, scene, active, opts) → { available, on, setOn, overlay }.
// The LoD2 scene and toolbar never depend on anything here: this hook runs only after the scene is up, every step
// is contained (try/catch, promise catch, WebGL context loss, 6 s watchdog) and a failure switches the option off
// with the reason on the layers menu. The LoD2 model stays when the server has no key, the root tileset fails, the
// house has no origin, the device's WebGL is weak, the GPU drops the context, or the mesh is not up within 6 s.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SpatialScene } from "./scene";
import type { PhotoLayer } from "./tiles";
import { anchorOf, isOrigin } from "@/lib/tilesGeo";
import { meshOff, setMeshWanted, useMeshPref } from "./meshPref";

type Status = { mode: "google" | "off"; root?: string; error?: string };

const credit = (bottom: number): React.CSSProperties => ({
  position: "absolute", left: 12, bottom, zIndex: 2, maxWidth: "calc(100% - 140px)", margin: 0,
  fontSize: 10, lineHeight: 1.3, color: "var(--ink-2)", background: "rgba(253, 253, 251, 0.85)", padding: "1px 6px",
  borderRadius: 6, pointerEvents: "none",
});

const msg = (why: unknown) => (why instanceof Error ? why.message : String(why));
const off = (why: unknown) => console.warn(`Mesh view off: ${msg(why)}`);

export function usePhoto(origin: unknown, scene: SpatialScene | null, active: boolean, opts: { creditBottom?: number } = {}): {
  available: boolean; on: boolean; setOn: (on: boolean) => void; overlay: ReactNode;
} {
  const on = useMeshPref().want;
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(false);
  const [text, setText] = useState("");
  const layer = useRef<PhotoLayer | null>(null);
  const o = isOrigin(origin) ? origin : null;
  const oKey = o ? o.join(",") : "";
  const wanted = on && active && !!o;

  useEffect(() => { setStatus(null); }, [oKey]);
  useEffect(() => { if (on) setFailed(false); }, [on]);

  // The status call warms the house's tiles on the server, so it waits for the planner's pick too.
  useEffect(() => {
    if (!wanted || status) return;
    const ac = new AbortController();
    fetch(`/api/tiles/status?o=${encodeURIComponent(oKey)}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((s: Status) => { setStatus(s); if (s.mode !== "google" || !s.root) meshOff(`Photo mesh unavailable: ${s.error ?? "no tiles here"}`); })
      .catch((e) => { if ((e as Error).name !== "AbortError") meshOff(`Photo mesh unavailable: ${msg(e)}`); });
    return () => ac.abort();
  }, [wanted, status, oKey]);

  const [capable, setCapable] = useState<boolean | null>(null);
  useEffect(() => {
    if (!scene || !wanted || capable !== null) return;
    let dead = false;
    import("./tiles")
      .then(({ photoCapable }) => {
        if (dead) return;
        const ok = photoCapable(scene);
        setCapable(ok);
        if (!ok) meshOff("Photo mesh unavailable: this device's graphics are too limited");
      })
      .catch((e) => { off(e); if (!dead) { setCapable(false); meshOff(`Photo mesh off: ${msg(e)}`); } });
    return () => { dead = true; };
  }, [scene, wanted, capable]);

  const available = !!o && !!status && status.mode === "google" && !!status.root && capable === true && !failed;
  const live = available && wanted && !!scene;

  useEffect(() => {
    if (!live || !scene || !o || !status?.root) return;
    let dead = false;
    const fail = (e: unknown) => { if (dead) return; off(e); setFailed(true); meshOff(`Photo mesh off: ${msg(e)}`); };
    const ua = navigator.userAgent;
    const safari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
    const phone = window.matchMedia("(max-width: 640px), (pointer: coarse)").matches;
    import("./tiles").then(({ PhotoLayer }) => {
      if (dead) return;
      try {
        layer.current = new PhotoLayer(scene, {
          root: status.root!, anchor: anchorOf(o), phone: phone || safari,
          onReady: () => { if (!dead) setShown(true); },
          onFail: fail,
          onCredit: (t) => { if (!dead) setText(t); },
        });
      } catch (e) { fail(e); }
    }).catch(fail);
    return () => {
      dead = true;
      try { layer.current?.dispose(); } catch (e) { off(e); }
      layer.current = null; setShown(false); setText("");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, scene, status, oKey]);

  // Watchdog: whatever stalls (chunk, tiles, fit), no mesh within 6 s of picking it and the LoD2 model stays.
  useEffect(() => {
    if (!live || shown) return;
    const t = setTimeout(() => { off("no mesh within 6 s"); setFailed(true); meshOff("Photo mesh off: the tiles took too long"); }, 6000);
    return () => clearTimeout(t);
  }, [live, shown]);

  const overlay = live && shown ? <p style={credit(opts.creditBottom ?? 22)}>{["Google", ...text.split("; ").filter((x) => x && x !== "Google")].join(" · ")}</p> : null;

  return { available, on: live && shown, setOn: setMeshWanted, overlay };
}
