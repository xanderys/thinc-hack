import type { Rule, RuleConstant } from "@/lib/api";
import { n2 } from "@/lib/stage";

const RULE: Record<string, string> = { pv: "Solar", battery: "Battery", heatpump: "Heat pump", wallbox: "Wallbox", inverter: "Inverter",
  bat_kwp: "Battery per kWp", bat_day: "Battery per daily use", inv: "Inverter", hp: "Heat pump", wb: "Wallbox", fill: "Roof fill", cap: "Roof capacity", orient: "Orientation" };
export const CONST: Record<string, string> = {
  per_use_slope: "Share of the use-matching array", base_kwp: "Base array", module_kwp: "Module", battery_kwh_per_kwp: "Battery per kWp",
  battery_packages: "Packages on sale", evening_share: "Use after sunset", boiler_age_years: "Boiler age", full_load_hours: "Full-load hours",
  heat_price: "Heat price", wallbox_kw: "Wallbox", inverter_ratio: "Inverter per kWp",
};
export const human = (n: string, m: Record<string, string>) => m[n] ?? n.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const val = (v: unknown) => Array.isArray(v) ? v.map((x) => typeof x === "number" ? n2(x) : String(x)).join(", ") : typeof v === "number" ? n2(v) : String(v);

// Where a constant comes from: fitted on half of an installer's projects, or a textbook value.
function origin(c: RuleConstant, installer: string) {
  const f = c.fitted_on?.trim();
  if (!f || /textbook|literature|^none$/i.test(f)) return "textbook";
  const jobs = f.match(/(\d[\d,]*) new-system jobs/)?.[1];
  return `fitted on half of ${installer}'s projects${jobs ? `, ${jobs} jobs` : ""}`;
}

// v2.0: the named planner rules behind the design. Hidden when the engine sends none.
export default function Rules({ rules, installer }: { rules?: Rule[]; installer: string }) {
  if (!rules?.length) return null;
  return (
    <details className="s-rules">
      <summary>Rules</summary>
      <ol>
        {rules.map((r) => (
          <li key={r.name}>
            <p><b>{human(r.name, RULE)}.</b> {r.sentence}</p>
            {r.rule?.text && <p>{r.rule.text}</p>}
            {r.textbook && (
              <dl><div><dt>Reonic rule of thumb</dt><dd>{r.textbook.value != null && <span className="num">{val(r.textbook.value)}{r.textbook.unit ? ` ${r.textbook.unit}` : ""}</span>}<span className="src">{r.textbook.url ? <a href={r.textbook.url} target="_blank" rel="noreferrer">{r.textbook.source}</a> : r.textbook.source}</span></dd></div>
                {r.design?.value != null && <div><dt>This design</dt><dd><span className="num">{val(r.design.value)}{r.design.unit ? ` ${r.design.unit}` : ""}</span></dd></div>}
              </dl>
            )}
            {!!r.constants?.length && (
              <dl>{r.constants.map((c) => (
                <div key={c.name}><dt>{human(c.name, CONST)}</dt><dd><span className="num">{val(c.value)}{c.unit ? ` ${c.unit}` : ""}</span><span className="src">{origin(c, installer) === "textbook" ? `${c.source}; textbook` : origin(c, installer)}</span></dd></div>
              ))}</dl>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}
