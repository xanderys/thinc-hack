"use client";
import { useLayoutEffect, useRef } from "react";
import type { ComponentKey, Derivation } from "@/lib/api";
import { n2, named } from "@/lib/stage";

const SRC: Record<string, string> = {
  lead: "lead", answer: "you answered", pvgis: "PVGIS", lod2: "LoD2 roof", iwu: "IWU",
  "installer history": "installer history", catalogue: "catalogue", default: "assumed",
};
const SNAP: Partial<Record<ComponentKey, string>> = { pv: "snapped to whole modules", battery: "snapped to the installer's package" };

type Term = { op: string; v: string; u: string; name?: string; src?: string };

const num = (s: string) => Number(s.replace(/,/g, ""));
const fmt = (x: number) => n2(Math.round(x * 100) / 100);

// "5,000 kWh / 907 kWh per kWp = 5.51 kWp" into rows; ";" chains a second sum that starts from the first result.
function terms(d: Derivation, answered: boolean): Term[] {
  const out: Term[] = [];
  let carry: string | null = null;
  // "(5,000 + 3,000 EV) kWh" becomes "5,000 kWh + 3,000 kWh".
  const eq = d.equation.replace(/\(([^)]*)\)\s*([A-Za-z]+)/g, (_, inner: string, u: string) =>
    inner.split(/\s*\+\s*/).map((t) => t.replace(/^([\d,.]+).*$/, `$1 ${u}`)).join(" + "));
  for (const seg of eq.split(";").map((s) => s.trim()).filter(Boolean)) {
    const parts = seg.split(/\s+(\/|x|×|=|\+)\s+/);
    for (let i = 0; i < parts.length; i += 2) {
      const o = parts[i - 1], op = i === 0 ? "" : o === "/" ? "÷" : o === "=" ? "=" : o === "+" ? "+" : "×";
      const m = parts[i].match(/^(EUR\s+)?(-?[\d,]*\.?\d+)(%?)\s*(.*)$/);
      if (!m) continue;
      const v = m[2] + m[3], u = (m[1] ? "EUR " : "") + m[4];
      if (i === 0 && carry === v) continue;
      const x = num(m[2]) / (m[3] ? 100 : 1);
      const inp = d.inputs.find((p) => typeof p.value === "number" && Math.abs(p.value - x) < 1e-6 * Math.max(1, Math.abs(x)) + 0.005);
      const src = inp ? (inp.name === "household use" && answered ? "you answered" : SRC[inp.source] ?? inp.source) : undefined;
      out.push({ op, v, u, name: inp?.name, src });
      if (op === "=") carry = v;
    }
  }
  return out;
}

type Props = { k: ComponentKey; d: Derivation; level: number; onMore: (n: number) => void; answered: boolean; installer: string; closing: boolean; ox: number; evKwh?: number | null };

export default function Why({ k, d, level, onMore, answered, installer, closing, ox, evKwh }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Grow out of the tapped number: transform origin sits under it.
  useLayoutEffect(() => { const el = ref.current; if (el) el.style.setProperty("--ox", `${ox - el.getBoundingClientRect().left}px`); }, [ox]);
  const rows = terms(d, answered);
  const last = rows.length - 1;
  const adj = d.adjustment;
  const lands = d.final != null && d.axiom_result != null && Math.abs(d.final - d.axiom_result) < 0.005;
  const label = adj ? named(adj.label.split(";")[0].trim()).replace(/^./, (c) => c.toUpperCase()) : "";
  const snapped = adj && d.final != null && d.axiom_result != null && Math.abs(d.axiom_result * adj.value - d.final) > 0.01 ? SNAP[k] : undefined;
  const more = level === 1 ? "Show the sum" : level === 2 && adj ? "Show what planners do" : level < 4 ? "Show the sources" : null;
  const next = level === 2 && !adj ? 4 : level + 1;

  return (
    <div ref={ref} className={closing ? "s-der out" : "s-der"}>
      <p className="axiom">{d.axiom}</p>
      {level >= 2 && rows.length > 0 && (
        <div className="ledger s-step">
          {rows.map((t, i) => {
            const sub = t.op === "=" && (i === last ? !lands || level < 3 : true);
            return [
              <span key={`o${i}`} className="op">{t.op}</span>,
              <span key={`v${i}${t.v}`} className={`v s-mark${sub ? " sub" : ""}`}>{t.v}</span>,
              <span key={`u${i}`} className="u">{t.u}</span>,
              <span key={`w${i}`} className={sub ? "w sub" : "w"}>{t.name ?? (t.op === "=" ? (i === last ? "what the physics alone asks for" : "") : "")}{t.src && <span className="src">{t.src}</span>}</span>,
            ];
          })}
          {level >= 3 && adj && (adj.value > 0 && d.final != null ? <>
            <span className="op adj s-step">×</span><span key={`a${adj.value}`} className="v adj s-mark">{fmt(adj.value)}</span><span className="u" /><span className="w s-step">{label}<span className="src">; {adj.n_similar} similar homes, {installer}</span></span>
            <span className="op fin">=</span><span key={`f${d.final}`} className="v fin s-mark">{fmt(d.final)}</span><span className="u fin">{rows[last]?.u}</span><span className="w fin">{snapped ?? "the design"}</span>
          </> : <>
            <span className="op fin" /><span className="v fin">none</span><span className="u fin" /><span className="w fin s-step">Left out. {label}<span className="src">; {adj.n_similar} similar homes, {installer}</span></span>
          </>)}
        </div>
      )}
      {level >= 2 && k === "pv" && evKwh != null && <p className="evn s-step">The car needs <span className="num">{n2(Math.round(evKwh))} kWh</span> a year.</p>}
      {level >= 2 && rows.length === 0 && <p className="eq s-step">{d.equation}</p>}
      {level >= 4 && (
        <dl className="srcs s-step">
          {d.inputs.map((p) => (
            <div key={p.name}><dt>{p.name}</dt><dd><span className="num">{typeof p.value === "number" ? (p.value < 1 && p.unit === "" ? `${Math.round(p.value * 100)}%` : fmt(p.value)) : p.value}</span>{p.unit && ` ${p.unit}`}<span className="src">{p.name === "household use" && answered ? "you answered" : SRC[p.source] ?? p.source}</span></dd></div>
          ))}
        </dl>
      )}
      {more && <button className="more" onClick={() => onMore(next)}>{more}</button>}
    </div>
  );
}
