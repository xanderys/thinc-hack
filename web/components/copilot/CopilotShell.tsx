"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Composer from "@/components/composer/Composer";
import Thread from "@/components/agent/Thread";
import { Ctx, type CopilotContext } from "./context";
import s from "./copilot.module.css";

const leadOf = (p: string) => p.match(/^\/h\/([^/]+)/)?.[1];
const shown = (p: string) => p === "/" || p.startsWith("/h/");
const Chev = ({ up }: { up?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={up ? undefined : { transform: "rotate(180deg)" }}><path d="M4.5 11 9 6.5l4.5 4.5" /></svg>
);

/** One copilot for the whole app: the composer line on the board, a glass circle on a lead page, one floating card from either. */
export default function CopilotShell() {
  const [path, setPath] = useState("/");
  const [name, setName] = useState<string | undefined>();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
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
    setName(undefined);
    if (!lead) return;
    let stop = false;
    fetch(`/api/leads/${encodeURIComponent(lead)}`).then((r) => r.json()).then((j) => { if (!stop && j?.customer_name) setName(j.customer_name); }).catch(() => {});
    return () => { stop = true; };
  }, [lead]);

  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [open]);

  // The composer's measured travel to the corner: right edge to 16 px from the right, bottom 16 px up, shrunk to 56 px.
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const set = () => {
      const dock = el.querySelector("form")?.parentElement as HTMLElement | null; if (!dock) return;
      const w = dock.offsetWidth, h = dock.offsetHeight;
      el.style.setProperty("--cs-x", `${innerWidth - 16 - (innerWidth / 2 + w / 2)}px`);
      el.style.setProperty("--cs-y", "-16px");
      el.style.setProperty("--cs-sx", String(56 / w)); el.style.setProperty("--cs-sy", String(56 / h));
    };
    set(); addEventListener("resize", set); const t = setTimeout(set, 600);
    return () => { removeEventListener("resize", set); clearTimeout(t); };
  }, [path]);

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
        <div className={s.dockWrap}><Composer /></div>
        {!asCircle && !open && <button type="button" className={s.expand} aria-label="Expand" aria-expanded={false} onClick={() => setOpen(true)}><Chev up /></button>}
        <div className={s.scrim} onClick={close} aria-hidden />
        <section className={s.card} data-copilot-card aria-hidden={!open} aria-label="Copilot">
          {lead && name && <span className={s.chip}>{name}</span>}
          {open && <Thread onLead={goLead} trailing={<button type="button" className={s.collapse} aria-label="Collapse" aria-expanded onClick={close}><Chev /></button>} />}
        </section>
      </div>
      <button type="button" className={s.circle} aria-label="Open the copilot" data-on={asCircle && !open ? "1" : undefined} data-off={off} tabIndex={asCircle && !open ? 0 : -1} onClick={() => setOpen(true)}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3.5" y="6" width="17" height="12" rx="6" /><path d="M8 12h5" /></svg>
      </button>
    </Ctx.Provider>
  );
}
