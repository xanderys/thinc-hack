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
  const mock = health.h?.model_version.startsWith("mock");
  return (
    <header className="masthead">
      <Link href="/" className="title">Planner</Link>
      <span className={`engine${mock || health.err ? " mock" : ""}`}>
        {health.err ? health.err : !health.h ? "" : mock ? "Mock engine: fixtures, not the model" :
          `Physics engine, measured against ${health.h.trained_on.projects.toLocaleString("en-GB")} signed offers`}
      </span>
    </header>
  );
}
