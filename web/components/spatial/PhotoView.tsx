"use client";
// The mesh view: in 3D, Google Photorealistic 3D Tiles replace the LoD2 house under our layout, in the same scene.
// usePhoto(address, scene, active) → { available, on, setOn, overlay }. It is on by default whenever active (3D).
// The LoD2 model stays, silently, when the server has no key, the root tileset fails, the house has no anchor,
// the device's WebGL is weak, or the mesh is not up within 6 s.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SpatialScene } from "./scene";
import type { Anchor, PhotoLayer } from "./tiles";

type Status = { mode: "google" | "off"; root?: string; anchor?: Anchor; error?: string };

const credit: React.CSSProperties = {
  position: "absolute", left: 12, bottom: 22, zIndex: 2, maxWidth: "calc(100% - 140px)", margin: 0,
  fontSize: 10, lineHeight: 1.3, color: "var(--ink-2)", background: "rgba(253, 253, 251, 0.85)", padding: "1px 6px",
  borderRadius: 6, pointerEvents: "none",
};

export function usePhoto(address: string, scene: SpatialScene | null, active: boolean): {
  available: boolean; on: boolean; setOn: (on: boolean) => void; overlay: ReactNode;
} {
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  const [on, setOn] = useState(true);
  const [shown, setShown] = useState(false);
  const [text, setText] = useState("");
  const layer = useRef<PhotoLayer | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setStatus(null); setFailed(false); setOn(true);
    fetch(`/api/tiles/status?address=${encodeURIComponent(address)}`, { signal: ac.signal })
      .then((r) => r.json()).then((s: Status) => setStatus(s)).catch(() => {});
    return () => ac.abort();
  }, [address]);

  const [capable, setCapable] = useState(false);
  useEffect(() => {
    if (!scene) { setCapable(false); return; }
    import("./tiles").then(({ photoCapable }) => setCapable(photoCapable(scene))).catch(() => setCapable(false));
  }, [scene]);

  const available = !!status && status.mode === "google" && !!status.anchor && !!status.root && capable && !failed;
  const live = available && on && active && !!scene;

  useEffect(() => {
    if (!live || !scene || !status?.anchor || !status.root) return;
    let dead = false;
    const phone = window.matchMedia("(max-width: 640px), (pointer: coarse)").matches;
    import("./tiles").then(({ PhotoLayer }) => {
      if (dead) return;
      layer.current = new PhotoLayer(scene, {
        root: status.root!, anchor: status.anchor!, phone,
        onReady: () => { if (!dead) setShown(true); },
        onFail: (why) => { if (dead) return; console.warn(`Photo view off: ${why}`); setFailed(true); setOn(false); },
        onCredit: (t) => { if (!dead) setText(t); },
      });
    }).catch(() => { if (!dead) { setFailed(true); setOn(false); } });
    return () => { dead = true; layer.current?.dispose(); layer.current = null; setShown(false); setText(""); };
  }, [live, scene, status]);

  // Watchdog: whatever stalls (chunk, tiles, fit), no mesh within 6 s of entering 3D and the LoD2 model stays.
  useEffect(() => {
    if (!live || shown) return;
    const t = setTimeout(() => { console.warn("Mesh view off: no mesh within 6 s"); setFailed(true); }, 6000);
    return () => clearTimeout(t);
  }, [live, shown]);

  const overlay = live && shown ? <p style={credit}>{["Google", ...text.split("; ").filter((x) => x && x !== "Google")].join(" · ")}</p> : null;

  return { available, on: available && on, setOn, overlay };
}
