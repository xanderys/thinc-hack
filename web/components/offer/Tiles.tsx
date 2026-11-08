// The numbers that head the offer. Before and after happens inside each tile: after a sentence or a hand
// edit the old figure takes the label's place with an arrow for 1.5 s (the tile keeps its height); a variant
// switch is a plain crossfade. One spring, 0.35 s, bounce 0; under Reduce Motion the figure changes at once.
import { useEffect, useState, type ReactNode } from "react";
import Num from "./Num";
import s from "./offer.module.css";

export type TileMode = "arrow" | "fade";

function Tile({ k, v, mode, info, pending }: { k: string; v: string; mode: TileMode; info?: ReactNode; pending?: boolean }) {
  const [f, setF] = useState<{ v: string; was: string | null; n: number; mode: TileMode }>({ v, was: null, n: 0, mode });
  useEffect(() => { setF((x) => (x.v === v ? x : { v, was: mode === "arrow" ? x.v : null, n: x.n + 1, mode })); }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!f.was) return; const t = setTimeout(() => setF((x) => ({ ...x, was: null })), 1500); return () => clearTimeout(t); }, [f.n, f.was]);
  return (
    <div data-info={info ? "" : undefined}>
      <dt>{f.was ? <span key={`w${f.n}`} className={s.was}>{f.was} <span aria-label="to">→</span></span> : k}</dt>
      {/* Pending: no value at all under the shimmer (an old price must never show through). */}
      <dd>{pending ? <span className="b-skel" aria-hidden="true" style={{ display: "inline-block", width: `${Math.max(5, v.length)}ch`, height: "1em" }} /> : <Num v={v} lit />}</dd>
      {info && <span className={s.tileInfo}>{info}</span>}
    </div>
  );
}

export default function Tiles({ items, mode, pending }: { items: { k: string; v: string; info?: ReactNode }[]; mode: TileMode; pending?: boolean }) {
  return (
    <dl className={s.tiles} data-pending={pending || undefined}>
      {items.map((x) => <Tile key={x.k} k={x.k} v={x.v} mode={mode} info={x.info} pending={pending} />)}
    </dl>
  );
}
