"use client";
import type { ReactNode } from "react";
import s from "./agent.module.css";

// A small Markdown reader for the agent's answers: paragraphs, bullets, GitHub tables, bold, code,
// [[ok|warn|fail: text]] badges, [[lead: Name|id]] chips and bold figures with a light unit.
export function openLead(id: string) { history.pushState({ h: id }, "", `/h/${id}`); dispatchEvent(new PopStateEvent("popstate")); }

const INLINE = /\[\[(ok|warn|fail):\s*([^\]]+)\]\]|\[\[lead:\s*([^|\]]+)\|([^\]]+)\]\]|\*\*([^*]+)\*\*(\s?(?:kWp|kWh|kW|%|pts|years?|a year|per year|modules|W))?|`([^`]+)`/g;

export function inline(text: string, onLead: (id: string) => void): ReactNode[] {
  const out: ReactNode[] = []; let last = 0, k = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<span key={k++} className={`${s.badge} ${s[m[1]]}`}>{m[2].trim()}</span>);
    else if (m[3]) { const id = m[4].trim(); out.push(<button key={k++} type="button" className={s.chip} onClick={() => onLead(id)}>{m[3].trim()}</button>); }
    else if (m[5] != null) out.push(<span key={k++} className={s.fig}><b>{m[5]}</b>{m[6] && <span className={s.unit}>{m[6]}</span>}</span>);
    else if (m[7]) out.push(<code key={k++}>{m[7]}</code>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Pipes inside [[lead: Name|id]] are not column breaks.
const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").replace(/\[\[[^\]]*\]\]/g, (m) => m.replace(/\|/g, "\u0000")).split("|").map((c) => c.trim().replace(/\u0000/g, "|"));

export default function Blocks({ text, onLead }: { text: string; onLead: (id: string) => void }) {
  const lines = text.split("\n"); const out: ReactNode[] = []; let i = 0, k = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (l.trim().startsWith("|") && lines[i + 1] && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(l); const body: string[][] = []; i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) body.push(cells(lines[i++]));
      const num = head.map((_, c) => body.every((r) => !r[c] || /^[\s*€+\-−\d.,%a-zA-Z]*\d/.test(r[c]) && !/\[\[lead/.test(r[c])));
      out.push(<div key={k++} className={s.tableWrap}><table className={s.table}><thead><tr>{head.map((h, c) => <th key={c} className={num[c] ? s.num : ""}>{inline(h, onLead)}</th>)}</tr></thead>
        <tbody>{body.map((r, j) => <tr key={j}>{head.map((_, c) => <td key={c} className={num[c] ? s.num : ""}>{inline(r[c] ?? "", onLead)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ""));
      out.push(<ul key={k++} className={s.list}>{items.map((t, j) => <li key={j}>{inline(t, onLead)}</li>)}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].trim().startsWith("|") && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) para.push(lines[i++].replace(/^#+\s*/, ""));
    out.push(<p key={k++} className={s.p}>{inline(para.join(" "), onLead)}</p>);
  }
  return <>{out}</>;
}
