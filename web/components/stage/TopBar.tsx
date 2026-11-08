"use client";
import type { AskQuestion, Design, DesignResponse, HomeInputs, InstallerId, Overrides, OverrideValue, ReadResponse, RoofResult } from "@/lib/api";
import { COMPONENT_DESIGN_FIELD } from "@/lib/api";
import { Fix } from "@/components/DesignSheet";
import { KEYS, NAME, optionLabel, QUESTION } from "@/lib/stage";
import Facts from "./Facts";
import { askOptions, Marked, PREFS, type Pref } from "./Lead";
import { STEP, UNIT } from "./Refine";

type Props = {
  noDecide?: boolean;   // the open card: preference, locks and Approve live in the Offer stage
  lead: string; read: ReadResponse; inputs: HomeInputs; roof: RoofResult | null;
  onFact: (f: keyof HomeInputs, v: unknown, label: string) => void; setInstaller: (i: InstallerId) => void;
  liveAsking?: string | null;
  factsSlot?: React.ReactNode;   // the end of the facts row, for a button that belongs beside it
  question: AskQuestion | null; answer: unknown; onAnswer: (v: unknown) => void; askError: string | null; asking: boolean;
  pref: Pref; setPref: (p: Pref) => void;
  res: DesignResponse | null; overrides: Overrides; setOverride: (f: keyof Design, v: OverrideValue | undefined) => void;
  canUndo: boolean; onUndo: () => void; approvedAt: string | null; onApprove: () => void;
};

// The open card's top bar: the inputs as chips, the one question, the preference, locks and Approve.
export default function TopBar(p: Props) {
  const i = p.inputs;
  return (
    <section className="t-bar" aria-label="Inputs and decisions">
      {p.liveAsking && <p className="t-asking" aria-live="polite"><span className="dot" aria-hidden />Asking: {p.liveAsking}</p>}
      {p.question && (
        <div className="t-ask s-in">
          <span>{QUESTION[p.question.field] ?? `What is ${String(p.question.field)}?`}</span>
          <span className="seg" role="group" aria-label="Answer">
            {askOptions(p.question).map((o) => (
              <button key={String(o.value)} type="button" className={typeof o.value === "number" ? "num" : undefined} aria-pressed={p.answer === o.value} onClick={() => p.onAnswer(o.value)}>
                {optionLabel(p.question!.field, o.value)}
              </button>
            ))}
          </span>
          {p.question.field.endsWith("_kwh") && <span className="s-quiet">kWh</span>}
        </div>
      )}
      {p.asking && <p className="s-quiet s-wait">Finding the one question that matters</p>}
      {p.askError && <p className="s-quiet" role="status"><span className="src">Engine said </span>{p.askError}</p>}
      <Facts origin={p.read.origin} inputs={i} roof={p.roof} onFact={p.onFact} hidden={p.question && p.answer === undefined ? p.question.field : null} slot={p.factsSlot} />
      {!p.noDecide && <Decide {...p} />}
      {(p.lead || p.read.found.length > 0) && (
        <details className="t-mail"><summary>{p.read.source === "call" ? "From the call" : "The enquiry"}</summary>
          <div className="s-mail">{p.read.source === "call" ? p.lead || "Facts from the call." : <Marked text={p.lead} quotes={p.read.found.map((f) => f.quote)} />}</div>
        </details>
      )}
    </section>
  );
}

// Preference, locks, Undo and Approve: the top bar on the stage page, the Offer stage in the open card.
export function Decide(p: Pick<Props, "pref" | "setPref" | "res" | "overrides" | "setOverride" | "canUndo" | "onUndo" | "approvedAt" | "onApprove"> & { slim?: boolean }) {
  // The open card: preference buttons and Locks are gone, Undo is in the sentence bar; only Approve stays here.
  if (p.slim) return p.res ? (
    <div className="t-row"><span className="t-go">{p.approvedAt ? <span className="s-approved s-mark">Approved {p.approvedAt}</span> : <button className="btn" onClick={p.onApprove}>Approve</button>}</span></div>
  ) : null;
  return (
    <div className="t-row">
        <div className="s-pref t-pref" role="group" aria-label="Preference">
          {PREFS.map(([k, label]) => <button key={k} type="button" aria-pressed={p.pref === k} onClick={() => p.setPref(k)}>{label}</button>)}
        </div>
        {p.res && (
          <details className="t-locks">
            <summary>Locks{Object.keys(p.overrides).length ? ` (${Object.keys(p.overrides).length})` : ""}</summary>
            <div className="t-locks-in">
              {KEYS.map((k) => { const f = COMPONENT_DESIGN_FIELD[k]; return <div className="s-handrow" key={k}><span className="n">{NAME[k]}</span><Fix field={f} current={p.res!.design[f]} unit={UNIT[f]} step={STEP[k]} overrides={p.overrides} setOverride={p.setOverride} /></div>; })}
            </div>
          </details>
        )}
        <span className="t-go">
          {p.canUndo && <button className="btn ghost" onClick={p.onUndo}>Undo</button>}
          {p.res && (p.approvedAt
            ? <span className="s-approved s-mark">Approved {p.approvedAt}</span>
            : <button className="btn" onClick={p.onApprove}>Approve</button>)}
        </span>
    </div>
  );
}
