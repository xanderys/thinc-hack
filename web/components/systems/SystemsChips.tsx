"use client";
// One row under the model: "Systems" in the heading font, then the four filter chips. A chip moves the camera,
// the info block and the layer on the model together.
import { SYSTEMS, type SystemName } from "./system";
import "./systems.css";

type Props = { active: SystemName | null; onPick: (k: SystemName) => void; moved?: Set<SystemName> };

export default function SystemsChips({ active, onPick, moved }: Props) {
  return (
    <div className="sys-head">
      <h2 className="sys-h" id="sys-h">Systems</h2>
      <div className="sys-chips" role="tablist" aria-labelledby="sys-h">
        {SYSTEMS.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={active === x.key} className={`sys-chip${moved?.has(x.key) ? " hot" : ""}`}
            style={{ ["--c" as string]: x.colour, ["--c-ink" as string]: x.ink }} onClick={() => onPick(x.key)}>
            <i aria-hidden="true" />{x.label}
          </button>
        ))}
      </div>
    </div>
  );
}
