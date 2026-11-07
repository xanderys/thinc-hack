import type { Rule, RuleConstant } from "@/lib/api";
import { n2 } from "@/lib/stage";

// Where a constant comes from: fitted on half of an installer's projects, or a textbook value.
function origin(c: RuleConstant, installer: string) {
  const f = c.fitted_on?.trim();
  if (!f || /textbook|literature|^none$/i.test(f)) return "textbook";
  if (/^fitted/i.test(f)) return f;
  return `fitted on half of ${/installer/i.test(f) ? f : installer}'s projects`;
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
            <p><b>{r.name}.</b> {r.sentence}</p>
            {r.constants.length > 0 && (
              <dl>{r.constants.map((c) => (
                <div key={c.name}><dt>{c.name}</dt><dd><span className="num">{typeof c.value === "number" ? n2(c.value) : c.value}{c.unit ? ` ${c.unit}` : ""}</span><span className="src">{c.source}; {origin(c, installer)}</span></dd></div>
              ))}</dl>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}
