"use client";
// Adapter for the planner's kit diagram (lane 2, web/components/offer/KitDiagram.tsx).
// Until that lands on main, this holds the diagram's box at its final size so the page never moves when it is swapped in.
import type { Design } from "@/lib/api";

export const KIT_HEIGHT = 148; // px, phone and desktop

export default function KitSlot({ design }: { design: Design | null }) {
  void design; // the real diagram takes the offered design
  return <div className="hk-slot" style={{ height: KIT_HEIGHT }} aria-hidden />;
}
