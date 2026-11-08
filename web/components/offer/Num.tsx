// A figure that springs to its new value ("€12,250" to "€15,820", "6.3 kWp" to "10.35 kWp"): the first number in the
// string counts up or down on a critically damped spring (duration 0.4 s, bounce 0), starting from the value on screen if
// a change lands mid-flight. Frames write the existing text node, so a switch costs no React renders. Strings without
// a number, or with different words around it, swap at once; under Reduce Motion the figure crossfades instead.
import { useLayoutEffect, useRef, useState, useEffect } from "react";
import s from "./offer.module.css";

type P = { pre: string; n: number; post: string; dec: number; group: boolean };
const parse = (x: string): P | null => {
  const m = /^(.*?)(-?\d[\d,]*(?:\.\d+)?)(.*)$/.exec(x);
  if (!m) return null;
  const raw = m[2];
  return { pre: m[1], n: Number(raw.replace(/,/g, "")), post: m[3], dec: raw.includes(".") ? raw.split(".")[1].length : 0, group: raw.includes(",") || Math.abs(Number(raw.replace(/,/g, ""))) >= 1000 };
};
const fmt = (p: P, x: number, dec: number) => p.pre + (p.group ? x.toLocaleString("en-GB", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : x.toFixed(dec)) + p.post;
const W = (2 * Math.PI) / 0.4;   // the spring's angular frequency for a 0.4 s duration

function useReduce() {
  const [r, setR] = useState(false);
  useEffect(() => { const m = matchMedia("(prefers-reduced-motion: reduce)"); setR(m.matches); const f = () => setR(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return r;
}

export default function Num({ v, className, lit }: { v: string; className?: string; lit?: boolean }) {
  const el = useRef<HTMLSpanElement>(null);
  const was = useRef(v), now = useRef<number | null>(null), raf = useRef(0);
  const reduce = useReduce();
  useLayoutEffect(() => {
    const a = parse(was.current), b = parse(v), node = el.current?.firstChild;
    const changed = was.current !== v;
    was.current = v;
    cancelAnimationFrame(raf.current);
    // The changed figure lights briefly (colour only, so it stays under Reduce Motion).
    if (changed && lit) el.current?.animate([{ backgroundColor: "#fff0c2" }, { backgroundColor: "#fff0c2", offset: 0.3 }, { backgroundColor: "rgba(255, 240, 194, 0)" }], { duration: 1400, easing: "ease-out" });
    if (reduce || !a || !b || a.pre !== b.pre || a.post !== b.post || a.n === b.n || !node) { now.current = b?.n ?? null; return; }
    const from = now.current ?? a.n, to = b.n, dec = Math.max(a.dec, b.dec), t0 = performance.now();
    const step = (t: number) => {
      const k = (t - t0) / 1000, p = 1 - (1 + W * k) * Math.exp(-W * k);
      if (p > 0.9995) { node.nodeValue = v; now.current = to; return; }
      const x = from + (to - from) * p;
      // In flight the figure moves in steps a real offer could show (€10, 0.05 kWp), so no in-between reads as a price.
      const q = /€/.test(b.pre) ? 10 : /kWp/.test(b.post) ? 0.05 : 0;
      now.current = x; node.nodeValue = fmt(b, q ? Math.round(x / q) * q : x, dec);
      raf.current = requestAnimationFrame(step);
    };
    node.nodeValue = fmt(b, from, dec);   // before paint: the old figure stays on screen, then moves
    raf.current = requestAnimationFrame(step);
  }, [v, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return <span ref={el} key={reduce ? v : undefined} className={`${s.num} ${reduce ? s.figFade : ""} ${className ?? ""}`}>{v}</span>;
}
