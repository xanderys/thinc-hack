// Plain line glyphs for components and variants, drawn on a 20 unit grid with a 1.6 stroke.
import type { ReactNode } from "react";

const P: Record<string, ReactNode> = {
  pv: <><circle cx="10" cy="10" r="3.6" /><path d="M10 1.5v2.4M10 16.1v2.4M1.5 10h2.4M16.1 10h2.4M4 4l1.7 1.7M14.3 14.3L16 16M4 16l1.7-1.7M14.3 5.7L16 4" /></>,
  inverter: <><rect x="3" y="2.5" width="14" height="15" rx="2.5" /><path d="M6.5 10c1-2 2.2-2 3.5 0s2.5 2 3.5 0" /></>,
  battery: <><rect x="2" y="6" width="14" height="8" rx="2" /><path d="M18 9v2" /><path d="M5 10h5" /></>,
  wallbox: <><rect x="4" y="2.5" width="9" height="15" rx="2" /><path d="M13 7h2a1.5 1.5 0 011.5 1.5v5a1.5 1.5 0 003 0V9" /><path d="M9.3 6.5L7.5 10h3l-1.8 3.5" /></>,
  heatpump: <><rect x="2.5" y="4" width="15" height="12" rx="2" /><circle cx="8.5" cy="10" r="3.2" /><path d="M8.5 6.8v6.4M5.3 10h6.4" /><path d="M14 7.5v5" /></>,
  grid: <><path d="M10 2l-4 16M10 2l4 16M7 8h6M5.5 13h9" /></>,
  // Variants: planners' pick (a set square), independence (a shield), payback (a clock), upfront (a wallet), edit (a pencil).
  expert: <><path d="M3.5 16.5V4l12.5 12.5z" /><path d="M6.5 13.5V11l2.5 2.5z" /></>,
  independence: <><path d="M10 2.5l6 2.2v4.6c0 4-2.6 6.6-6 8.2-3.4-1.6-6-4.2-6-8.2V4.7z" /></>,
  payback: <><circle cx="10" cy="10" r="7.5" /><path d="M10 5.5V10l3 2" /></>,
  upfront: <><path d="M3 6.5h12.5a1.5 1.5 0 011.5 1.5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 15V5a1.5 1.5 0 011.5-1.5H14v3" /><path d="M13 11.5h1.5" /></>,
  edit: <><path d="M12.5 4l3.5 3.5L7 16.5H3.5V13z" /><path d="M10.5 6l3.5 3.5" /></>,
  lock: <><rect x="4.5" y="9" width="11" height="8" rx="1.8" /><path d="M7 9V6.5a3 3 0 016 0V9" /></>,
};

export default function Glyph({ k, size = 16, colour = "currentColor", label }: { k: keyof typeof P | string; size?: number; colour?: string; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={colour} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label}>
      {P[k]}
    </svg>
  );
}
