"use client";
// The planner's parts list (lane 2, KitSheet) for the homeowner pages, read-only; the skeleton keeps a similar height.
import type { Design } from "@/lib/api";
import KitSheet from "@/components/offer/KitSheet";
import type { Sku, SkuPart } from "@/components/offer/facts";

export default function KitSlot({ design, total, modules, assumptions, skus }: { design: Design | null; total?: number | null; modules?: number | null; assumptions?: string[] | null; skus?: Partial<Record<SkuPart, Sku>> }) {
  return (
    <div className="hk-slot" aria-hidden={design ? undefined : true}>
      {design && <KitSheet kit={{ ...design, modules: modules ?? null }} total={total} assumptions={assumptions} skus={skus} />}
    </div>
  );
}
