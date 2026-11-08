"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Agent from "@/components/agent/Agent";
import { Ctx, type CopilotContext } from "./context";
import s from "./copilot.module.css";

const leadOf = (p: string) => p.match(/^\/h\/([^/]+)/)?.[1];
const shown = (p: string) => p === "/" || p.startsWith("/h/");

/** One copilot for the whole app: a floating card on the board, a glass circle on a lead page, the card again from the circle. */
export default function CopilotShell() {
  const [path, setPath] = useState("/");
  const [name, setName] = useState<string | undefined>();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const lead = leadOf(path) ? decodeURIComponent(leadOf(path)!) : undefined;
  const asCircle = !!lead;

  // The path follows pushState on the same tick, so the circle starts moving on the frame the card zooms.
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

  const card = () => wrap.current?.querySelector(":scope > section") as HTMLElement | null;
  // The agent lane owns the card's open state; the shell watches it and drives its own buttons.
  useEffect(() => {
    const el = card(); if (!el) return;
    const read = () => setOpen(el.getAttribute("aria-hidden") === "false");
    read(); const mo = new MutationObserver(read); mo.observe(el, { attributes: true, attributeFilter: ["aria-hidden"] });
    return () => mo.disconnect();
  }, []);
  const press = useCallback((expanded: boolean) => { (wrap.current?.querySelector(`button[aria-expanded="${expanded}"]`) as HTMLButtonElement | null)?.click(); }, []);

  // The composer's measured travel to the corner: its right edge to 16 px from the right, its bottom to 16 px up, shrunk to 56 px.
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const set = () => {
      const dock = el.querySelector("form")?.parentElement as HTMLElement | null; if (!dock) return;
      const w = dock.offsetWidth, h = dock.offsetHeight;
      el.style.setProperty("--cs-x", `${innerWidth - 16 - (innerWidth / 2 + w / 2)}px`);
      el.style.setProperty("--cs-y", "-16px");
      el.style.setProperty("--cs-sx", String(56 / w)); el.style.setProperty("--cs-sy", String(56 / h));
    };
    set(); addEventListener("resize", set);
    const t = setTimeout(set, 600);
    return () => { removeEventListener("resize", set); clearTimeout(t); };
  }, [path]);

  // Touching the 3D canvas or scrolling down puts the card back in its corner.
  useEffect(() => {
    if (!asCircle || !open) return;
    let y = scrollY, down = 0;
    const onDown = (e: PointerEvent) => { if ((e.target as HTMLElement | null)?.closest?.("canvas")) press(true); };
    const onScroll = (e: Event) => {
      const t = e.target as HTMLElement | Document;
      if (t instanceof HTMLElement && wrap.current?.contains(t)) return;   // the thread scrolling is not the page
      const now = t instanceof HTMLElement ? t.scrollTop : scrollY;
      down = now > y ? down + (now - y) : 0; y = now;
      if (down > 40) press(true);
    };
    document.addEventListener("pointerdown", onDown, true); document.addEventListener("scroll", onScroll, true);
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("scroll", onScroll, true); };
  }, [asCircle, open, press]);

  const ctx = useMemo<CopilotContext>(() => ({ leadId: lead, name }), [lead, name]);
  const el = card();
  return (
    <Ctx.Provider value={ctx}>
      <div ref={wrap} className={s.shell} data-lead={asCircle ? "1" : undefined} data-off={shown(path) ? undefined : "1"}>
        <Agent />
      </div>
      {el && lead && name && createPortal(<span className={s.chip}>{name}</span>, el)}
      <button type="button" className={`${s.circle} ${asCircle && !open ? s.circleOn : ""}`} aria-label="Open the copilot" tabIndex={asCircle && !open ? 0 : -1}
        data-off={shown(path) ? undefined : "1"} onClick={() => press(false)}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3.5" y="6" width="17" height="12" rx="6" /><path d="M8 12h5" /></svg>
      </button>
    </Ctx.Provider>
  );
}
