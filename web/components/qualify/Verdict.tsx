"use client";
// Verdict chip, offer value and the site-visit note. Colours: Reonic navy for Priority, the one blue for Call first, a neutral for Decline.
import type { DesignResponse, HomeInputs, RoofResult } from "@/lib/api";
import { offerEur, qualify, VERDICT_WORD, type Qualification, type Verdict } from "@/lib/qualify";
import { recallVerdict, useRoofs } from "./roof";
import s from "./qualify.module.css";

// tip: the facts count ("7 of 9 facts stated") lives on the chip as its tooltip, never in the line.
export function VerdictChip({ verdict, className, tip }: { verdict: Verdict | null; className?: string; tip?: string }) {
  return <span title={tip} className={`${s.chip} ${verdict ? s[verdict] : s.checking} ${className ?? ""}`}>{verdict ? VERDICT_WORD[verdict] : "Checking"}</span>;
}

/** Header line: the chip and the planner's sentence, nothing else. */
export function VerdictLine({ q }: { q: Pick<Qualification, "verdict" | "sentence" | "reason"> & Partial<Pick<Qualification, "facts">> | null }) {
  if (!q) return <span className={s.line}><VerdictChip verdict={null} /></span>;
  return <span className={s.line}><VerdictChip verdict={q.verdict} tip={q.facts ? `${q.facts.stated} of ${q.facts.total} facts stated` : undefined} /><span className={s.sent}>{reasonOf(q)}</span></span>;
}

// Verdicts kept from before the reason field read their sentence after the verdict word.
export const reasonOf = (q: Pick<Qualification, "sentence"> & { reason?: string }) => q.reason ?? q.sentence.split(": ").slice(1).join(": ");

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
