"use client";
// Verdict chip, offer value and the site-visit note. Colours: Reonic navy for Visit, the one blue for Call first, a neutral for Decline.
import type { DesignResponse, HomeInputs, RoofResult } from "@/lib/api";
import { offerEur, qualify, VERDICT_WORD, type Qualification, type Verdict } from "@/lib/qualify";
import { recallVerdict, useRoofs } from "./roof";
import s from "./qualify.module.css";

export function VerdictChip({ verdict, className }: { verdict: Verdict | null; className?: string }) {
  return <span className={`${s.chip} ${verdict ? s[verdict] : s.checking} ${className ?? ""}`}>{verdict ? VERDICT_WORD[verdict] : "Checking"}</span>;
}

/** Header line: chip plus the sentence after its colon. */
export function VerdictLine({ q }: { q: Pick<Qualification, "verdict" | "sentence"> | null }) {
  if (!q) return <span className={s.line}><VerdictChip verdict={null} /></span>;
  return <span className={s.line}><VerdictChip verdict={q.verdict} /><span className={s.sent}>{(([w]) => w.charAt(0).toUpperCase() + w.slice(1))([q.sentence.split(": ").slice(1).join(": ")])}</span></span>;
}

const isPc = (x?: string | null) => !!x && /^\s*\d{5}\s*$/.test(x);

/** The open card's qualification from what the card is showing now (the planner's current inputs and design).
 *  The facts count comes from the lead as the board read it (the open card fills gaps with address estimates, which are not stated). */
export function useCardQualification(inputs: HomeInputs, res: DesignResponse | null, leadId?: string | null): Qualification | null {
  // Once the roof is known the stage sends the roof instead of the address, so the roof's address counts as the street.
  const known = inputs.roof && !inputs.roof.pending && ["lod2", "google-solar", "osm"].includes(inputs.roof.source) ? inputs.roof : null;
  const address = inputs.address && !isPc(inputs.address) ? inputs.address : known?.matched_address ?? null;
  const roofs = useRoofs([known ? null : address]);
  if (!res) return null;
  const roof: RoofResult | null | undefined = address ? known ?? roofs[address] : null;
  if (address && roof === undefined) return null;
  const q = qualify({ status: "draft", facts: inputs, address_or_postcode: address ?? "" }, res, roof);
  const kept = leadId ? recallVerdict(leadId) : null;
  return kept ? { ...q, confidence_line: kept.confidence_line } : q;
}

/** Beside the four numbers: the offer value, the confidence chip and one honesty line. */
export function OfferValue({ q }: { q: Qualification | null }) {
  if (!q) return null;
  return (
    <div className={s.value}>
      <p className={s.vH}><span>Expected offer</span><b>{offerEur(q.expected_offer_eur)}</b></p>
      <p className={s.conf}>{q.confidence_line}</p>
      <p className={s.est}>Every number here is an estimate until the site visit.</p>
    </div>
  );
}

/** End of the Offer stage, above Approve. */
export function SiteVisitNote({ q }: { q: Qualification | null }) {
  if (!q) return null;
  return <p className={s.note}><b>Confirm on site:</b> {q.confirm_on_site.join(", ")}.</p>;
}
