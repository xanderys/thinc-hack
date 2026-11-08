"use client";
import { useEffect, useState } from "react";

// A street-level photo needs a street and number, not a postcode alone.
export const hasStreet = (a?: string | null) => !!a && /[A-Za-zÄÖÜäöüß].*\d|\d.*[A-Za-zÄÖÜäöüß]/.test(a.split(",")[0] ?? "") && a.includes(",");

// Front-of-house photo from the engine. Shows nothing until it has loaded; a 404, an error or a slow answer
// (over 12 s) leaves the layout as it was. Fades in once (opacity only).
export default function HousePhoto({ address, className, onShown }: { address?: string | null; className?: string; onShown?: (shown: boolean) => void }) {
  const [state, setState] = useState<"wait" | "ok" | "none">("wait");
  const ok = hasStreet(address);
  useEffect(() => {
    setState("wait");
    if (!ok) { setState("none"); return; }
    const t = setTimeout(() => setState((s) => (s === "wait" ? "none" : s)), 8000);
    return () => clearTimeout(t);
  }, [address, ok]);
  useEffect(() => { onShown?.(state === "ok"); }, [state, onShown]);
  if (!ok || state === "none") return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={`h-photo${state === "ok" ? " on" : ""}${className ? ` ${className}` : ""}`} src={`/api/photo?address=${encodeURIComponent(address!)}`} alt="" loading="lazy" decoding="async"
      onLoad={() => setState((s) => (s === "none" ? s : "ok"))} onError={() => setState("none")} />
  );
}
