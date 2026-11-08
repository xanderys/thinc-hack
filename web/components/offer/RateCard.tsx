// The rate card in an "i": every euro of a total as the engine's market model prices it, summing to the shown total.
import type { Design } from "@/lib/api";
import { eur } from "./format";
import { rateCard, skuName, type Sku, type SkuPart } from "./facts";
import Info from "./Info";
import s from "./offer.module.css";

export default function RateCard({ design, total, assumptions, modules, skus }: { design: Partial<Design>; total: number; assumptions?: string[] | null; modules?: number | null; skus?: Partial<Record<SkuPart, Sku>> }) {
  const card = rateCard(design, total, assumptions, modules);
  if (!card) return null;
  // Lines name the product where the engine sends one; the rate stays the market rate per kWp or kWh.
  const LABEL_SKU: Record<string, SkuPart> = { Solar: "module", "Solar modules and inverter": "module", Battery: "battery", "Battery storage": "battery" };
  for (const l of card.lines) { const s = skus?.[LABEL_SKU[l.label]]; if (s) l.label = skuName(s); }
  return (
    <Info label="How the price is estimated">
      <p className={s.rateH}>Market estimate, not the installer&rsquo;s price list</p>
      <dl className={s.rate}>
        {card.lines.map((l) => (
          <div key={l.label}><dt>{l.label}{l.calc && <span>{l.calc}</span>}</dt><dd>{eur(l.eur)}</dd></div>
        ))}
        <div className={s.rateT}><dt>Total</dt><dd>{eur(card.total)} <em>estimate</em></dd></div>
      </dl>
    </Info>
  );
}
