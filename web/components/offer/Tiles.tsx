// The numbers that head the offer. Before and after happens inside each tile: after a sentence or a hand
// edit the old figure takes the label's place with an arrow for 1.5 s (the tile keeps its height); a variant
// switch is a plain crossfade. One spring, 0.35 s, bounce 0; under Reduce Motion the figure changes at once.
import { useEffect, useState } from "react";
import s from "./offer.module.css";

export type TileMode = "arrow" | "fade";

function Tile({ k, v, mode }: { k: string; v: string; mode: TileMode }) {
  const [f, setF] = useState<{ v: string; was: string | null; n: number; mode: TileMode }>({ v, was: null, n: 0, mode });
  useEffect(() => { setF((x) => (x.v === v ? x : { v, was: mode === "arrow" ? x.v : null, n: x.n + 1, mode })); }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!f.was) return; const t = setTimeout(() => setF((x) => ({ ...x, was: null })), 1500); return () => clearTimeout(t); }, [f.n, f.was]);
  return (
    <div>
      <dt>{f.was ? <span key={`w${f.n}`} className={s.was}>{f.was} <span aria-label="to">→</span></span> : k}</dt>
      <dd><span key={f.n} className={f.n ? (f.mode === "arrow" ? s.figIn : s.figFade) : undefined}>{f.v}</span></dd>
    </div>
  );
}

export default function Tiles({ items, mode, pending }: { items: { k: string; v: string }[]; mode: TileMode; pending?: boolean }) {
  return (
    <dl className={s.tiles} data-pending={pending || undefined}>
      {items.map((x) => <Tile key={x.k} k={x.k} v={x.v} mode={mode} />)}
    </dl>
  );
}
