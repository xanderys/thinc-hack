"use client";
// The planner's kit diagram (lane 2) for the homeowner pages. The box has the tallest layout's proportions
// (solar, battery, wallbox and heat pump), so the skeleton and every loaded design occupy the same space.
import type { Design } from "@/lib/api";
import KitDiagram from "@/components/offer/KitDiagram";

export const KIT_RATIO = "360 / 224"; // viewBox of the fullest diagram

export default function KitSlot({ design }: { design: Design | null }) {
  return (
    <div className="hk-slot" style={{ aspectRatio: KIT_RATIO }} aria-hidden={design ? undefined : true}>
      {design && <KitDiagram kit={design} />}
    </div>
  );
}
