"use client";
// One glass card inside the canvas per Systems chip, carrying that system's calculation in a sentence or two.
// Desktop: the top-left corner; phone: the bottom edge above the model toolbar. data-cover, so the house fits
// beside it and never sits under it. The derivation (bars, equations, Why) waits behind the "i" in a popover that
// hangs off the card and leaves the house where it is.
// Motion: a chip change springs the new card in (0.5 s smooth spring, bounce 0, from 8 px); Reduce Motion: a crossfade.
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import type { SystemName } from "./system";
import "./systems.css";

type Props = { sys: SystemName; head: string; children: ReactNode; info?: ReactNode; pending?: boolean; extra?: ReactNode; extraLabel?: string; onMore?: (open: boolean) => void };

export default function SystemCard({ sys, head, children, info, pending, extra, extraLabel, onMore }: Props) {
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);   // the extra (Panels: the shading scrubber) folds behind its own chip
  useEffect(() => { setMore(false); }, [sys]);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { setOpen(false); }, [sys]);
  // Esc or a press anywhere outside closes the popover; the pass and the lead keep their own Esc.
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key !== "Escape") return; e.stopPropagation(); e.preventDefault(); setOpen(false); };
    const out = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener("keydown", esc, true); addEventListener("pointerdown", out, true);
    return () => { removeEventListener("keydown", esc, true); removeEventListener("pointerdown", out, true); };
  }, [open]);
  const id = `sc-pop-${sys}`;
  return (
    <div ref={root} className="sc" data-sys={sys}>
      {/* The section stays mounted so the canvas keeps measuring it (data-cover); the inner key replays the spring. */}
      <section className="sc-card" data-cover aria-label={head} data-pending={pending || undefined}>
        <div key={sys} className="sc-anim">
          <div className="sc-top">
            <h3 className="sc-h">{head}</h3>
            {info && (
              <button type="button" className="sc-i" aria-expanded={open} aria-controls={id} aria-label="How this was worked out" onClick={() => setOpen((x) => !x)}>
                <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.3" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M10 9v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="10" cy="6.2" r="1.1" fill="currentColor" /></svg>
              </button>
            )}
          </div>
          <div className="sc-body">{children}</div>
          {extra && (extraLabel
            ? <div className="sc-extra">
                <button type="button" className="sc-more" aria-expanded={more} onClick={() => { const v = !more; setMore(v); onMore?.(v); }}>{extraLabel}</button>
                {more && extra}
              </div>
            : <div className="sc-extra">{extra}</div>)}
        </div>
        {info && open && <div id={id} className="sc-pop" role="dialog" aria-label="How this was worked out" data-esc-first><InfoGuard>{info}</InfoGuard></div>}
      </section>
    </div>
  );
}

// A throw inside the working (a field the engine left out) shows its own words in the popover, never takes the card down.
class InfoGuard extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { error: e instanceof Error ? e.message : String(e) }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <p>The working could not be shown: {this.state.error} <button type="button" className="btn" onClick={() => this.setState({ error: null })}>Try again</button></p>;
  }
}
