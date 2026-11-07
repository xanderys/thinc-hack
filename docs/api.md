# Engine API contract (v2.7)

Base URL: `ENGINE_URL` (local `http://localhost:8000`, demo `https://xanders-mac-mini.tail3f074b.ts.net:8443`). JSON in and out. All sizes in kWp, kW, kWh. Demand in kWh per year. Money in EUR. The web app never computes a design itself.

## Types

```ts
type InstallerId = "2a8ba8e2" | "23c108b7";
type LoadProfile = "H0" | "FamilyOfFour" | "HomeOfficeOnePerson" | "FullTimeOnePerson" | "SeniorOnePerson" | "PartTimeOnePerson";
type HeatingType = "Gas" | "Oil" | "Heatpump" | "OtherNonRenewable" | "OtherRenewable" | "Unknown";

interface HomeInputs {
  installer_id: InstallerId;            // whose design style to reproduce
  annual_demand_kwh: number;            // household electricity, excl. heat pump and EV
  load_profile: LoadProfile;
  num_inhabitants?: number;
  house_size_sqm?: number;
  house_built_year?: number;
  has_ev: boolean;
  ev_annual_km?: number;
  has_wallbox: boolean;                 // existing
  heating_type: HeatingType;
  heating_cost_per_year_eur?: number;
  heating_demand_kwh?: number;
  electricity_price_ct_kwh?: number;    // default 32
  has_solar: boolean;  existing_solar_kwp?: number;
  has_storage: boolean; existing_storage_kwh?: number;
  address?: string;                     // v1.6: street address; the engine looks the roof up itself (roof/ package)
  roof?: RoofResult;                    // v1.6: or the web passes a prior lookup
}

interface RoofResult {                  // v1.6, from GET /api/roof?address=... (roof/roof.py lookup)
  source: "lod2" | "google-solar" | "osm" | "none";
  matched_address: string; lat: number | null; lon: number | null;
  footprint_m2: number | null; roof_area_m2: number | null; usable_area_m2: number | null;
  segments: { azimuth: number; pitch: number; area_m2: number }[];
  max_panels: number | null; max_kwp: number | null;      // usable_area_m2 / 5.5
  confidence: "measured" | "footprint" | "estimate" | "none"; notes: string[];
  pending?: boolean;                    // v2.4: the LoD2 tile is still downloading; result returns immediately with the standard face; poll again in 3 s
  floor_area_m2?: number | null; storeys?: number | null; floor_area_confidence?: "estimate";          // v1.6.1: LoD2 footprint x storeys x 0.8, upper bound
  build_year_class?: string | null; build_year_estimate?: number | null; heating_class?: string | null; // v1.6.1: Zensus 2022 100 m cell; heating_class is the system type (central, district, floor, stoves), never the fuel
  zensus_confidence?: string;                                                                          // "estimated from address (Zensus 2022, 100 m cell)"
}
// Web rule: when the lead lacks build year or floor area, the facts panel shows these labelled "estimated from address"; heating_class is never used to set heating_type.
// Preferences (v1.7): HomeInputs.preference?: "independence" | "payback" | "upfront" only reorders `variants` (first = preferred); the learned expert design stays `design`. The export has no preference data, so preference never changes the learned model.
// Engine behaviour with a roof: pv_kwp = min(model, max_kwp); plausibility gets one line ("the roof fits 57 modules, about 145 m2 at 25 degrees east-west, measured from Bavarian LoD2 data"); components.pv.derivation.inputs cites the roof source.

interface Design {
  pv_kwp: number | null;
  inverter_kw: number | null;
  battery_kwh: number | null;           // null = none
  heatpump_kw: number | null;           // null = none
  wallbox_kw: number | null;            // null = none
}

interface Neighbours { n: number; share_included: number; median_size: number | null; p25: number | null; p75: number | null; }

interface ComponentDetail {
  decision: "include" | "none";
  size: number | null; unit: "kWp" | "kWh" | "kW";
  confidence: number;                   // 0..1
  reason: string;                       // one sentence, grounded in data or physics
  alternatives: { size: number | null; label: string; share: number }[];
  neighbours: Neighbours;               // "homes like this one"
  derivation?: Derivation;              // v1.5, "why this number"
}

interface Derivation {                    // one axiom per component; the learned adjustment closes the gap honestly
  axiom: string;                          // one plain sentence, e.g. "A year of sun here should cover a year of use, then planners oversize."
  equation: string;                       // with this home's numbers, e.g. "5,000 kWh / 1,050 kWh per kWp = 4.8 kWp"
  inputs: { name: string; value: number | string; unit: string; source: "lead" | "answer" | "pvgis" | "iwu" | "installer history" | "catalogue" | "default" }[];
  axiom_result: number | null;            // 4.8
  adjustment: { label: string; value: number; n_similar: number } | null;  // "planners like yours oversize", x1.6, from 15 similar homes; null when the axiom alone gives the number
  final: number | null;                   // equals design.<component>; null = none
}

interface Plausibility { level: "ok" | "warn"; message: string; }

interface Economics {
  capex_eur: number; annual_saving_eur: number; payback_years: number | null;
  self_consumption_share: number; autarky_share: number;
  assumptions: string[];
  method?: "hourly-simulation" | "annual-lookup";   // v1.2
  replay_2025?: { pv_yield_kwh: number; autarky_share: number; feed_in_income_eur: number; bill_after_eur: number; payback_years: number | null; negative_price_hours: number; unpaid_export_kwh: number; note: string }; // v1.8: the same design replayed through the real 2025 year (Open-Meteo Munich weather, Energy-Charts day-ahead prices, negative hours paid zero); typical-year numbers above stay the headline
  annual?: { pv_yield_kwh: number; load_kwh: number; self_consumed_kwh: number; fed_in_kwh: number; grid_import_kwh: number; feed_in_income_eur: number; bill_before_eur: number; bill_after_eur: number; npv_20y_eur: number | null;
             battery_charged_kwh?: number; battery_discharged_kwh?: number; ev_charge_kwh?: number; ev_from_pv_kwh?: number; home_from_pv_kwh?: number };  // v1.3.1 flow fields
}

interface Optimum {                        // v1.2, from the hourly physics simulation
  design: Design;                         // economically optimal sizes for this home under the installer's catalogue
  economics: Economics;
  delta_vs_proposal: { capex_eur: number; annual_saving_eur: number; payback_years: number | null; autarky_share: number };
  note: string;                           // one sentence: where the expert habit and the maths disagree
}

interface Variant {                       // v1.7
  key: "expert" | "independence" | "payback" | "upfront";
  label: string;                          // "PV + storage (as planners here design it)", "Most independence", "Best payback", "Lowest upfront cost"
  design: Design;
  economics: Economics;
  note: string;                           // one sentence vs the expert variant
}

interface DesignResponse {
  design: Design;
  explanation: string[];                // 3 to 5 short sentences
  components: { pv: ComponentDetail; battery: ComponentDetail; heatpump: ComponentDetail; wallbox: ComponentDetail };
  plausibility: Plausibility[];
  economics: Economics;                 // v1.2: from the hourly simulation when available; economics.method says which
  optimum?: Optimum;                    // best 20-year NPV
  variants?: Variant[];                 // v1.7: offer variants the planner can pick by homeowner preference
  model_version: string;
}
```

## Endpoints

- `GET /api/roof?address=...` → `RoofResult` (v1.6; LoD2 first, Google Solar when `GOOGLE_SOLAR_API_KEY` is set, OSM footprint last; unknown address returns `source: "none"` with the geocoder's words)
- `GET /health` → `{ ok: true, model_version, trained_on: { projects, installers }, data_loaded: boolean }`
- `POST /api/design` body `{ inputs: HomeInputs }` → `DesignResponse`
- `POST /api/refine` body `{ inputs: HomeInputs, overrides?: Overrides }` → `DesignResponse & { diff: { component, from, to, why }[] }`. `Overrides = Partial<Record<keyof Design, number | null | "include">>`: a number fixes the size, `null` fixes none, `"include"` means include it and let the engine size it (v1.1). The engine re-sizes the rest around the overrides.
- `POST /api/validate` body `{ inputs: HomeInputs, design: Design }` → `{ flags: { component, level: "ok"|"unusual"|"implausible", message, neighbours: Neighbours }[] }`
- `GET /api/projects?split=test&limit=50` → `{ project_id, installer_id, inputs: HomeInputs, expert: Design }[]`
- `GET /api/projects/{project_id}` → `{ project_id, installer_id, inputs, expert: Design, ours: DesignResponse }`
- `GET /api/eval` → scoreboard:

```ts
interface Eval {
  split: { train: number; test: number; method: string };
  components: Record<"pv"|"battery"|"heatpump"|"wallbox", {
    decision_accuracy: number | null; baseline_decision_accuracy: number | null;
    size_mae: number | null; baseline_size_mae: number | null; unit: string;
    within_tolerance_share: number | null; tolerance: string;   // e.g. "±1 kWp"
    ceiling_within_tolerance_share?: number; textbook_within_tolerance_share?: number; floor_slope_within_tolerance_share?: number; // v1.1; baseline_* = textbook
  }>;
  overall: { design_match_share: number; baseline_design_match_share: number; definition: string;
             ceiling_design_match_share?: number; textbook_design_match_share?: number; floor_slope_design_match_share?: number };
  ceiling?: { method: string; pv_agreement_share: number; battery_agreement_share: number };  // planner self-agreement on near-identical inputs, v1.1
  per_installer: Record<InstallerId, { test: number; design_match_share: number }>;
  deviations: { project_id: string; component: string; ours: number | null; expert: number | null; note: string }[]; // top 20
  synthetic?: { n: number; generated_at: string; plausible_share: number; monotonicity_violations: number; invariants: { name: string; pass_share: number; n_checked: number; worst: unknown[] }[] }; // v1.4, from engine/synthetic
}
```

## v1.3 additions (LLM-free, additive)

- `POST /api/ask` body `{ inputs: HomeInputs, unknown?: (keyof HomeInputs)[] }` (when `unknown` is given, only those fields are candidates; `annual_demand_kwh` unknown → 3,000 | 5,000 | 6,500) → `{ questions: { field: keyof HomeInputs; current: unknown; options: { value: unknown; label: string; design: Design }[]; spread: number }[] }`, sorted by spread, top 3, empty when nothing moves. Candidates: `heating_type` Unknown → Gas | Heatpump; `has_ev` false → true at 12,000 km; `annual_demand_kwh` absent or the 4,500 default → 3,000 | 6,500; `heating_demand_kwh` missing on a fossil home → 12,000 | 20,000; `has_solar` false → true at 6 kWp. spread = Σ |Δsize| / tolerance (1 kWp, 2 kWh, 2 kW) plus 1 per decision flip, max over options.
- `GET /api/inbox?limit=20` → `{ project_id, installer_id, label, inputs: HomeInputs, draft: Design, confidence: number, expert: Design, within: { pv: boolean; battery: boolean; heatpump: boolean; wallbox: boolean; all: boolean }, note: string }[]` from the test split in demo order (varied installers, EV, heating; the first row a PV and battery hit); confidence = mean confidence of included components; `within` by the eval tolerances; `note` = the deviation note when `all` is false, else "".

## v1.9: the engine runs the call (rolling draft per lead)

State lives in the engine (in-memory plus JSON under `engine/.cache/leads/`). The step endpoint requires header `X-Intake-Secret: <shared secret>`; the secret lives on the mini in `~/.config/marquee/intake.env` (`INTAKE_SECRET=...`), read by the engine (env `INTAKE_SECRET`) and by the voice builder, never in git or chat. Rina calls step as an ElevenLabs server tool through the Funnel and must get an answer within 2 s.

- `POST /api/leads` body `{ customer_name, address_or_postcode, installer_id?, facts?: Partial<HomeInputs>, source: "form" | "call" }` → `{ lead_id, draft: DesignResponse, facts: HomeInputs, unknown: string[], next_question }`. Creates the lead, runs the roof or postcode lookup and the first draft from whatever is known.
- `POST /api/intake/step` body `{ lead_id, facts_so_far: IntakeFacts }` where `IntakeFacts` = HomeInputs names plus the voice intake names `address`, `postcode`, `customer_name`, `installer_name`, `home_office` (bool), `house_size_sqm`, `monthly_bill_eur` (→ annual_demand_kwh at the tariff when annual use is unknown), `heating_age`, `ev` ("now" | "planned" | "none" → has_ev), `ev_annual_km`, `preference`; the engine maps and keeps the latest value per field → `{ design: Design, draft: DesignResponse, changed: { component, from, to, why }[], next_question: { field, question: string, why: string, options?: { value, label }[], expected_swing: string } | null, done: boolean, step: number }`. `done` is true when no remaining unknown moves the design beyond tolerance (reuse /api/ask). Every step is appended to `engine/.cache/leads/steps.jsonl` (lead_id, step, field asked, answer, swing).
- `GET /api/leads/{lead_id}` → `{ lead_id, status: "draft" | "in_call" | "done", customer_name, address_or_postcode, facts, draft: DesignResponse, history: { step, field, answer, changed, at }[], next_question, questions_asked: number, created_at, updated_at }`.
- `GET /api/leads?limit=20` → the latest leads, newest first, with status and a one-line title.
- `GET /api/intake/priors` → `{ n_steps_logged, order: { field, mean_swing, times_asked }[] }`: question priors re-ranked from the step log ("it learns which questions matter"); /api/ask uses them as tie-breakers only.

## v2.0: transparent recommender (shapes unchanged)
- `GET /health` adds `recommender: "rules" | "ml"` and `rules_version`.
- `DesignResponse.explanation[]` are the rule sentences that fired; `components.<k>.derivation.axiom` is the rule, `adjustment.label` names the fitted constant and its source, `final` the result.
- `DesignResponse.rules?: { name, sentence, constants: { name, value, unit, source, fitted_on }[] }[]` lists every rule applied.
- `Eval.recommenders?: Record<"formula" | "blackbox" | "textbook", { design_match_share: number; pv_within: number; battery_within: number; wallbox_decision: number }>` on the same test homes; `Eval.deviation_quality?: { n_differ: number; ours_better_payback: number; expert_better_payback: number; ours_better_autarky: number; expert_better_autarky: number; method: string }`.

## v2.1: real house model
- `GET /api/roof/model?address=...` → `{ address, source: "lod2", textured: boolean, licence: string, model_url: string, planes: { id, polygon: [number, number, number][], pitch, azimuth, area_m2, is_target, yield_kwh_per_kwp, sun, max_panels, chosen_panels: { x, y, w, h, angle }[] }[], neighbours: number, triangles: number }`; `GET /api/roof/model/file?address=...` serves the .glb (cache for a day). `RoofResult.model_url` points at the first. Absent when no LoD2 hit; the UI keeps the line drawing.

## v2.2: front photo (optional, Google key on the engine host only)
- `GET /api/roof/photo?address=...` proxies a Street View Static image (cached by address; 404 with Google's words when there is none). `RoofResult.photo_url?` points at it; `RoofResult.google_panels?` (Solar API maxArrayPanelsCount) when available. Never a dependency.

## v2.3: explanation layers for the spatial demonstration
- `POST /api/explain/layers` body `{ inputs: HomeInputs, design?: Design }` → `{ planes: (as /api/roof/model, with chosen_panels for this design), day: { date: string; hours: { h: number; pv_kw: number; load_kw: number; battery_kw: number; grid_kw: number; soc_kwh: number }[] }, night: { evening_kwh: number; night_hours: number; battery_kwh: number; htw_cap_kwh: number }, frontier: { kwp: number; kwh: number; capex_eur: number; npv_20y_eur: number; autarky_share: number; payback_years: number | null; chosen: boolean; label?: string }[], chosen: Design, objective: { name: string; sentence: string; sources: string[] }, sources: { key: string; citation: string; url?: string }[] }`. Day = a representative spring weekday from the hourly year. Cached per inputs hash.

## v2.5: homeowner decision (demo acceptance, not a qualified e-signature)
- `PUT /api/leads/{lead_id}/approve` header `X-Intake-Secret`, body `{ variant?: Variant["key"] }` → `{ status: "approved", approved_at, approved_variant, proposal_hash }` (sha256 over `{design, variant, investment_eur}`, engine-owned; every lead read carries the current `proposal_hash`; a planner change after approval drops the lead to `done` and it must be approved again). Sign before approval returns 409.
- `POST /api/leads/{lead_id}/decision` body `{ action: "sign" | "decline" | "question", name?: string, accepted?: boolean, signature_png?: string (data URL, under 200 KB), question?: string, proposal_hash: string }` → `{ ok, status, decided_at, proposal_hash }`. Open to the homeowner site (no secret), rate limited; the engine stores the signature image under `engine/.cache/leads/sig/<lead_id>.png`, never in the API response beyond `has_signature`. Lead status becomes `signed`, `declined` or `question`; `decision: { action, name, decided_at, proposal_hash, has_signature, matches_current, question? }` appears on GET /api/leads and /api/leads/{id}. `proposal_hash` = sha256 of the design, variant key and investment the homeowner saw; the planner's card shows a warning if the current draft's hash differs.

## v2.6: working-shown bars
- `POST /api/explain/layers` adds `bars: { key: "roof" | "heat_loss" | "day" | "charging"; title; total; unit; segments: { name; value; unit; source_tag: "lead" | "rina" | "address" | "default"; citation?: string }[]; sentence: string; sources: string[] }[]` in chain order and `checks: { name; value; unit; pass: boolean; band: string }[]` (payback, autarky band, DC/AC, roof fit). Additive read of existing fields; no grid or radiator check.

## v2.7: comparison, cashflow, check bands
- `rule_of_thumb_comparison: { reonic_kwp_per_mwh, planners_kwp_per_mwh, this_design_kwp_per_mwh }` lives at `components.pv.derivation.rule_of_thumb_comparison` and at `Eval.rule_of_thumb_comparison`.
- `checks[]` entries carry `level: "ok" | "info" | "reference" | "fail"`, `pass`, and for banded checks `inside_band: boolean`.
- `Economics.cashflow_cumulative_eur: number[]` (21 values from year 0) and `cashflow_yearly_eur: number[]`; `break_even_year`, `irr`.
- Eval columns: `readout` (production), `band`, `calibrated`, `formula`, `blackbox`, `textbook` (generic), `reonic_rule` (Reonic's published rule of thumb), later `rules5`; labels in `recommenders_labels`.

Natural-language refinement ("the family buys an EV next year") is handled in `web/` (`POST /api/interpret` → `{ changes: { field, from, to, note }[], inputs: HomeInputs }`) with the Claude API, then `web/` calls `/api/refine`. The engine has no LLM.

Errors: non-2xx with `{ error: string }` in the source's own words.

## v2.7 (engine 9acc4ca, additive): envelope elements for the heat pump step
The envelope block on `/api/explain/layers` (`planes.envelope`) and `/api/roof/model` (`envelope`) gains:
- `elements[]`: `{ element: "outer_wall" | "window" | "floor" | "ceiling" | "roof" | "ventilation" | "thermal_bridges" | "total", label, w, a_m2, u, dt_k, share, note? }`. Floor dT is the design difference times 0.5 (TABULA b_tr). `ceiling` is 0 W with a note (heated roof space, the roof is the boundary). `ventilation` carries `air_changes_per_h` and `volume_m3`. `total` carries `design_heat_load_kw`. The heat-loss bar and the x-ray tint both read `elements[].share`.
- `faces[].window_share` and `faces[].window_share_source` on wall and window faces: window area over gross wall on that side. Currently 0.20 for every build-year class, as roof/model assumes.
- `constants`: `{ bivalence_c: { value: -6, unit: "C", label, source }, hot_water_kw_per_person: { value: 0.5, unit: "kW per person", label, source } }`.
- `estimated_from: "address"`.
