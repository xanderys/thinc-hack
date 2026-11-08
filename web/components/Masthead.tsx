"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { call } from "@/lib/client";
import type { Health } from "@/lib/api";

export default function Masthead() {
  const path = usePathname();
  const [health, setHealth] = useState<{ h?: Health; err?: string }>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    call<Health>("/api/health").then((r) => setHealth(r.ok ? { h: r.data } : { err: r.error }));
  }, [tick]);
  useEffect(() => {
    if (!health.err) return;
    const t = setTimeout(() => setTick((x) => x + 1), 10000);
    return () => clearTimeout(t);
  }, [health.err, tick]);
  return (
    <header className="masthead">
      {/* An open card: one way back to the board, the chevron at the left of the banner. */}
      {/^\/h\//.test(path ?? "") && (
        <button type="button" className="back" aria-label="Back to the board" onClick={() => { if (dispatchEvent(new CustomEvent("marquee:back", { cancelable: true }))) location.assign("/"); }}>
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4L6.5 10l6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      )}
      <Link href="/" className="title">MARQUEE</Link>
      {/* The bar carries only the name; it speaks only when the engine cannot be reached, in the engine's own words. */}
      {health.err && <span className="engine mock">{health.err}</span>}
    </header>
  );
}
