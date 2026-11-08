"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ComposerField from "@/components/composer/ComposerField";
import Thread from "@/components/agent/Thread";
import * as agentStore from "@/components/agent/store";
import { startSuggestions } from "@/components/agent/store";
import { suggest, type SuggestLead } from "@/components/agent/suggest";
import { Ctx, type CopilotContext } from "./context";
import s from "./copilot.module.css";

const leadOf = (p: string) => p.match(/^\/h\/([^/]+)/)?.[1];
const safe = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sab")) || 0;
const shown = (p: string) => p === "/" || p.startsWith("/h/");
const Chev = ({ up }: { up?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={up ? undefined : { transform: "rotate(180deg)" }}><path d="M4.5 11 9 6.5l4.5 4.5" /></svg>
);

/** One copilot for the whole app: the composer line on the board, a glass circle on a lead page, one floating card from either. */
export default function CopilotShell() {
  const [path, setPath] = useState("/");
  const [name, setName] = useState<string | undefined>();
  const [open, setOpen] = useState(false);
  const [leadSug, setLeadSug] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const cardEl = useRef<HTMLElement>(null);
  const noop = () => {};
  // The agent lane's pendingSuggestion and lastFirstLine; guarded until they land.
  const [sug, setSug] = useState<{ dot: boolean; line: string }>({ dot: false, line: "" });
  useEffect(() => {
    const read = () => {
      const m = agentStore as unknown as { pendingSuggestion?: unknown; lastFirstLine?: unknown };
      const dot = m.pendingSuggestion === true, line = typeof m.lastFirstLine === "string" ? m.lastFirstLine.trim() : "";
      setSug((p) => (p.dot === dot && p.line === line ? p : { dot, line }));
    };
    read(); const iv = setInterval(read, 500); return () => clearInterval(iv);
  }, []);
  useEffect(() => startSuggestions(), []);   // the chips and the dot poll only while the shell is mounted
  const lead = leadOf(path) ? decodeURIComponent(leadOf(path)!) : undefined;
  const asCircle = !!lead;

  // The path follows pushState on the same tick, so the circle starts moving on the frame the board card zooms.
  useEffect(() => {
    const sync = () => setPath(location.pathname);
    sync();
    const h = history as History & { __copilot?: boolean };
    if (!h.__copilot) {
      h.__copilot = true;
      for (const k of ["pushState", "replaceState"] as const) {
        const orig = h[k].bind(h);
        h[k] = (...a: Parameters<History["pushState"]>) => { orig(...a); dispatchEvent(new Event("copilot:nav")); };
      }
    }
    addEventListener("copilot:nav", sync); addEventListener("popstate", sync);
    return () => { removeEventListener("copilot:nav", sync); removeEventListener("popstate", sync); };
  }, []);

  useEffect(() => {
    setName(undefined); setLeadSug(false);
    if (!lead) return;
    let stop = false;
    // The circle's dot: the same suggest() the card's chips use, so it shows whenever a chip waits, even with the card closed.
    fetch(`/api/leads/${encodeURIComponent(lead)}`).then((r) => r.json()).then((j) => { if (stop || !j?.customer_name) return; setName(j.customer_name); setLeadSug(suggest({ leadId: lead, name: j.customer_name }, j as SuggestLead).length > 0); }).catch(() => {});
    return () => { stop = true; };
  }, [lead]);

  // Escape closes the open card first: a window capture listener added when the shell mounts (in the layout, so before
  // any page's own capture listeners), which stops there so the pass or a chooser underneath does not also react.
  const openNow = useRef(open); openNow.current = open;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key !== "Escape" || !openNow.current) return; e.stopImmediatePropagation(); e.preventDefault(); setOpen(false); };
    addEventListener("keydown", k, true); return () => removeEventListener("keydown", k, true);
  }, []);

  // Where the card morphs from: the board's field or the lead page's circle, as a transform of the card's own box (FLIP).
  useEffect(() => {
    const el = wrap.current, card = cardEl.current; if (!el || !card) return;
    const set = () => {
      const w = card.offsetWidth, h = card.offsetHeight; if (!w || !h) return;
      let r: { left: number; top: number; width: number; height: number } | null = null;
      if (asCircle) { const c = document.querySelector<HTMLElement>("[data-copilot-circle]"); r = c ? { left: c.offsetLeft, top: c.offsetTop, width: 56, height: 56 } : { left: innerWidth - 16 - 56, top: innerHeight - 16 - 56 - safe(), width: 56, height: 56 }; }
      else { const f = el.querySelector("form")?.getBoundingClientRect(); if (f && f.width) r = { left: f.left, top: f.top, width: f.width, height: f.height }; }
      if (!r) return;
      el.style.setProperty("--from", `translate(${r.left - card.offsetLeft}px, ${r.top - card.offsetTop}px) scale(${r.width / w}, ${r.height / h})`);
      // The glass keeps its shape on the way: elliptical corner radii cancel the stretch, so the pill grows into the card.
      el.style.setProperty("--r0x", `${(asCircle ? 28 : 26) * (w / r.width)}px`); el.style.setProperty("--r0y", `${(asCircle ? 28 : 26) * (h / r.height)}px`);
      // The composer line's own travel to the corner on a lead page.
      const dock = el.querySelector("form")?.parentElement as HTMLElement | null;
      if (dock) {
        const dw = dock.offsetWidth, dh = dock.offsetHeight;
        el.style.setProperty("--cs-x", `${innerWidth - 16 - (innerWidth / 2 + dw / 2)}px`); el.style.setProperty("--cs-y", "-16px");
        el.style.setProperty("--cs-sx", String(56 / dw)); el.style.setProperty("--cs-sy", String(56 / dh));
      }
    };
    set(); addEventListener("resize", set); const t = setTimeout(set, 600);
    return () => { removeEventListener("resize", set); clearTimeout(t); };
  }, [path, asCircle, open]);
  // The open card covers the 3D scene: its render loop rests until the card closes (hook guarded until the scene has it).
  useEffect(() => {
    if (!open) return;
    const sc = () => (window as unknown as { __marqueeScene?: { pause?: () => void; resume?: () => void } }).__marqueeScene;
    sc()?.pause?.();
    return () => { sc()?.resume?.(); };
  }, [open]);
  // Opening by focus or tap puts the cursor in the Thread's own field.
  // While open: the page behind stays still, and on a phone the card rides on the keyboard (visualViewport).
  useEffect(() => {
    if (!open) return;
    const b = document.body.style, was = b.overflow; b.overflow = "hidden";
    const vv = window.visualViewport, el = wrap.current;
    const fit = () => {
      if (!vv || !el) return;
      const gap = innerHeight - (vv.height + vv.offsetTop);   // the keyboard and the form bar; under 40 px it is only the toolbar
      if (gap > 40) el.style.setProperty("--kb-bottom", `${gap + 8}px`); else el.style.removeProperty("--kb-bottom");
      el.style.setProperty("--vvh", `${vv.height}px`); el.style.setProperty("--vvw", `${vv.width}px`);
    };
    fit(); vv?.addEventListener("resize", fit); vv?.addEventListener("scroll", fit);
    return () => { b.overflow = was; vv?.removeEventListener("resize", fit); vv?.removeEventListener("scroll", fit); for (const k of ["--kb-bottom", "--vvh", "--vvw"]) el?.style.removeProperty(k); };
  }, [open]);
  useEffect(() => { if (open) { const t = setTimeout(() => (cardEl.current?.querySelector("textarea") as HTMLTextAreaElement | null)?.focus(), 120); return () => clearTimeout(t); } }, [open]);

  // Touching the 3D canvas or scrolling the page down puts the card back in its corner.
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!asCircle || !open) return;
    let y = scrollY, down = 0;
    const onDown = (e: PointerEvent) => { if ((e.target as HTMLElement | null)?.closest?.("canvas")) close(); };
    const onScroll = (e: Event) => {
      const t = e.target as HTMLElement | Document;
      if (t instanceof HTMLElement && t.closest("[data-copilot-card]")) return;   // the thread scrolling is not the page
      const now = t instanceof HTMLElement ? t.scrollTop : scrollY;
      down = now > y ? down + (now - y) : 0; y = now;
      if (down > 40) close();
    };
    document.addEventListener("pointerdown", onDown, true); document.addEventListener("scroll", onScroll, true);
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("scroll", onScroll, true); };
  }, [asCircle, open, close]);

  const ctx = useMemo<CopilotContext>(() => ({ leadId: lead, name }), [lead, name]);
  const off = shown(path) ? undefined : "1";
  const goLead = (id: string) => { setOpen(false); history.pushState({ h: id }, "", `/h/${id}`); dispatchEvent(new PopStateEvent("popstate")); };
  return (
    <Ctx.Provider value={ctx}>
      <div ref={wrap} className={s.shell} data-lead={asCircle ? "1" : undefined} data-open={open ? "1" : undefined} data-off={off}>
        <div className={s.dockWrap}>
          <div aria-hidden style={{ height: "var(--composer-h, 96px)" }} />
          <ComposerField value="" onChange={noop} onSend={noop} onAttach={() => setOpen(true)} onMicStart={() => setOpen(true)} onMicStop={noop} onActivate={() => setOpen(true)} />
        </div>
        <div className={s.scrim} onClick={close} aria-hidden />
        <section ref={cardEl} className={s.card} data-copilot-card aria-hidden={!open} aria-label="Copilot">
          <div className={s.glass} aria-hidden />
          <div className={s.content}>
          {lead && name && <span className={s.chip}>{name}</span>}
          {open && <Thread onLead={goLead} trailing={<button type="button" className={s.collapse} aria-label="Collapse" aria-expanded onClick={close}><Chev /></button>} />}
          </div>
        </section>
      </div>
      <button type="button" className={s.circle} data-copilot-circle aria-label="Open the copilot" title={sug.line || undefined} data-on={asCircle && !open ? "1" : undefined} data-off={off} tabIndex={asCircle && !open ? 0 : -1} onClick={() => setOpen(true)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}<img src="/copilot/friday.png" alt="Copilot" width={56} height={56} draggable={false} />{(sug.dot || leadSug) && <span className={s.dot} aria-hidden />}
      </button>
    </Ctx.Provider>
  );
}
