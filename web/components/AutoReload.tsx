"use client";
// A tab running an older build reloads itself, quietly, once the planner is not typing or waiting on a change.
// Checks every 60 s and on focus; keeps the scroll per path through the reload (the open lead is in the URL).
import { useEffect } from "react";

const BUILT = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
const SCROLL = (p: string) => `marquee.scroll.${p}`;
const DONE = "marquee.reloaded-for";

// Requests that change something or wait on the model: a reload must not cut them off.
let busy = 0;
function track() {
  const w = window as Window & { __mqFetch?: boolean };
  if (w.__mqFetch) return;
  w.__mqFetch = true;
  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const watch = method !== "GET" || /\/api\/(interpret|copilot|refine)/.test(url);
    if (!watch) return orig(input, init);
    busy++;
    return orig(input, init).finally(() => { busy--; });
  };
}

const typing = () => {
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable);
};

export default function AutoReload() {
  useEffect(() => {
    track();
    // Restore the scroll kept before a reload, once the page is tall enough (cards load in).
    const key = SCROLL(location.pathname);
    const kept = Number(sessionStorage.getItem(key) ?? "NaN");
    if (Number.isFinite(kept)) {
      sessionStorage.removeItem(key);
      // Hold it while cards load in and other parts settle (8 s), until the planner scrolls or types themselves.
      history.scrollRestoration = "manual";
      const until = Date.now() + 8000;
      let mine = false;
      const own = () => { mine = true; };
      const evs = ["wheel", "touchstart", "keydown", "mousedown"] as const;
      evs.forEach((e) => addEventListener(e, own, { passive: true, once: true }));
      const step = () => {
        if (mine || Date.now() > until) { evs.forEach((e) => removeEventListener(e, own)); return; }
        if (Math.abs(scrollY - kept) > 2 && document.documentElement.scrollHeight - innerHeight >= kept) scrollTo(0, kept);
        requestAnimationFrame(step);
      };
      step();
    }
    if (BUILT === "dev" && !/[?&]reloadcheck=1/.test(location.search)) return;
    let stop = false;
    const check = async () => {
      if (stop || document.visibilityState === "hidden") return;
      let build: string | undefined;
      try { build = (await fetch("/api/version", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)))?.build; } catch { return; }
      if (!build || build === BUILT || build === "dev") return;
      if (sessionStorage.getItem(DONE) === build) return;   // reloaded for it once already: never loop
      if (typing() || busy > 0) return;                     // next check or focus tries again
      sessionStorage.setItem(DONE, build);
      sessionStorage.setItem(SCROLL(location.pathname), String(Math.round(scrollY)));
      location.reload();
    };
    const t = setInterval(check, 60000);
    addEventListener("focus", check);
    return () => { stop = true; clearInterval(t); removeEventListener("focus", check); };
  }, []);
  return null;
}
