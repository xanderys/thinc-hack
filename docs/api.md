# Engine API contract (v2.16)

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
  electricity_price_ct_kwh?: number;    // default 37 (BDEW Aug 2026; the hourly economics); the rough ratio fallback in rules.py still uses 32
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

## v2.8 (engine 1510b93, additive): imagery vintage
`RoofResult` (`/api/roof`) and the roof model (`/api/roof/model`) carry `imagery: { dop20_flown: "YYYY-MM-DD" | null, lod2_stand: "YYYY-MM-DD" | null, source_note: string }`. `dop20_flown` is the DOP20 date from the LDBV WMS info layer (`by_dop20_info`, field `ua`). `lod2_stand` is the matched building's LoD2 CityGML `creationDate`. A date missing from the source is null and `source_note` says why (postcode only, no building, or tile still being read). No date is ever estimated.

## v2.9 (engine 47dd147, additive): test leads
`POST /api/leads` accepts `test: boolean` (default false), stored on the lead. `GET /api/leads` leaves test leads out unless `include_test=1`, and its rows carry `test`. `GET /api/leads/{id}` serves test leads as usual. Agents create scratch leads with `test: true`. Every write to a pinned lead is logged server-side (route, client, user agent); nothing is blocked.

## v2.10 (engine 2e9bc07, additive): lead versions and stale-write rejection
Every lead carries `version`, an integer that only goes up. It is bumped on every write, engine background redrafts included, and returned on `GET /api/leads`, `GET /api/leads/{id}` and every lead write response (create, intake step, approve, decision, reset, pin). `POST /api/intake/step`, `PUT /api/leads/{id}/approve` and `POST /api/leads/{id}/decision` accept an optional `base_version`, as does `POST /api/refine` together with `lead_id` (refine never writes a lead; there the check only tests freshness). When `base_version` is below the stored version, the call answers `409 { error, version, lead }` and nothing is written. Without `base_version` the call is accepted as before. Clients send the version from their latest read or write response, never count it up, and on 409 adopt the lead in the body. The `X-Client-Route` request header is logged with each write to a pinned lead.

## v2.11 (engine 50acec6): approval integrity, call status, building geometry
- `DesignResponse`, `/api/refine` and every variant carry `design_hash`: sha256 over `{ design: the five sizes, variant, investment_eur }`, keys sorted, compact JSON, the same formula as `proposal_hash`. The top level uses `"expert"`, refine with overrides uses `"edit"`, each variant uses its key.
- `PUT /api/leads/{id}/approve` body: `{ variant?: "expert" | "value" | "payback" | "independence" | "upfront" | "edit", design_hash?, design?, overrides?, base_version? }`. It needs `design_hash` or `design`; `variant` defaults to `"edit"` when only a design is sent. `"edit"` re-runs the lead's inputs with the overrides, or with every size fixed to the shown design, and that result is what gets approved. A missing selection, a differing `design_hash` or a differing design gives `409 { error, version, lead }` and approves nothing. On success the lead stores `approved { variant, design, economics, investment_eur, design_hash, overrides? }`; `GET /api/leads/{id}` returns it and `proposal_hash` is computed from it. A step that changes the design after approval, or a reset, drops `approved`.
- `POST /api/intake/step` sets status `in_call` only for call steps; a request whose `X-Client-Route` contains `sentence` or `hand` keeps the previous status. The 10-minute expiry still ends calls.
- `/api/roof` (address) carries `geometry { footprint_m2, storeys, height_m, large_building, source, note }` measured from LoD2; `large_building` is true at a footprint of 300 m² or more, 4 or more storeys, or a height of 12 m or more. The web ranks it above `dwellings_class` on conflict.

## v2.12 (engine eb69e14, additive): stated roof direction versus the measured roof
When the inputs state a roof direction (`roof_azimuth_deg`, or `roof_orientation` as a compass word) and the address has a LoD2 model, `DesignResponse` carries `roof { stated_azimuth_deg, measured_azimuths_deg, stated_direction_conflict, source, note? }`. The conflict is true when the stated direction is more than 45 degrees from every measured face. The design always follows the measured faces, and on conflict the explanation begins with "Roof measured from the building model; your stated <direction> face was not found." Without a building model there is no roof block, and the stated direction drives the yield.

## v2.13 (engine, additive): kit overrides kept on the lead
- `POST /api/intake/step` takes `overrides?: Partial<Record<"pv_kwp" | "battery_kwh" | "heatpump_kw" | "wallbox_kw" | "inverter_kw", number | null | "include">>`, validated as `/api/refine` (unknown key, non-number or out-of-range value is 422). It is stored on the lead and bumps `version`; `{}` clears it; `base_version` still gives 409. Unknown `lead_id` with overrides is 404.
- Overrides alone (no `facts_so_far`, no `answers`) return `{ version, overrides, status }` with no redraft and no history step. An unchanged value writes nothing. A change on an approved or signed lead drops `approved` and sets status `done`, as a fact change does.
- `GET /api/leads/{id}` returns `overrides` (`{}` when none). The web applies them through `/api/refine` to show the kit.

## v2.14 (engine, additive): WhatsApp copilot, Complete and Send, planned car, stated heating
Phone and facts
- `POST /api/leads` takes `phone?: string` (E.164; spaces allowed, 8 to 15 digits, else 422). `PUT /api/leads/{id}/phone {phone: string | null, base_version?}` sets or removes it, and `POST /api/intake/step` takes `phone?` (phone alone returns `{version, phone, status}` with no redraft). Phone survives reset. The pinned demo leads carry `the demo phone (env)`. `GET /api/leads/{id}` returns `phone`.
- `POST /api/intake/step` takes `source?: "whatsapp" | "call" | "form" | "planner"`. Every fact it changes is recorded in `GET /api/leads/{id}` → `fact_sources: Record<field, source>`, and `sources: Record<field, "stated" | "estimated" | "whatsapp">` covers every public fact, which the chips use for "via WhatsApp". A whatsapp step never opens "On a call".
- HomeInputs gains `ev_planned: boolean` (sized like `has_ev`; `has_ev: false` clears it; voice/interpret `ev: "planned"` sets both) and `heating_stated?: string`: the word as stated ("District", "Electric", "Gas", "Heat pump"), set whenever `heating_type` is given in words. `heating_type` stays the kind sizing uses (district and electric → `OtherNonRenewable`, wood and pellets → `OtherRenewable`).

WhatsApp copilot (also the general tool call for any installer)
- `POST /api/leads/{id}/whatsapp/ask` header `X-Intake-Secret`, body `{facts?: Field[], base_version?}` → `{conversation_id, sent: true, open_facts: Field[], asking: Field[], version, whatsapp}`. `Field` is one of `annual_demand_kwh | heating_type | has_ev | heating_demand_kwh | has_solar | num_inhabitants`. Default `open_facts`: the facts missing or estimated on the lead, the one that moves the design most first (the next-question ranking). One message in Rina's voice asks the first two. Errors: 409 no phone, a phone the line cannot reach, a conversation already open on this lead, or nothing missing; 502 with the provider's words; nothing is sent on any error. A new ask on another lead with the same phone supersedes that lead's open conversation (state `superseded`, nothing sent).
- Replies: while a conversation is open the engine polls the provider every 5 s. Each reply (text, or a voice note transcribed with ElevenLabs speech to text, local Whisper as fallback) goes to the web's `POST <WEB_URL>/api/interpret` with `X-Intake-Secret` and `{mode: "whatsapp", lead_id, text, open_facts}`, where `open_facts` is `{field, label, unit?, options?}[]`, expecting `{facts: Record<string, unknown>, confidence?: number, unclear?: Field[]}`. Facts use HomeInputs or voice-intake names. They are written through the intake step with `source: "whatsapp"`, so the design re-runs. A failed interpreter call (404 while it ships, timeout) is logged in `last_error` and the reply is retried on the next poll.
- After each reply: an unclear or empty reply gets one follow-up on the facts it missed; otherwise the next one or two missing facts are asked. After 3 outbound rounds, or when nothing is missing, Rina closes: "Thanks, that's everything, your design is ready." The closing carries no link: the proposal link travels only in the send. A conversation idle for 30 min becomes `expired`.
- `GET /api/leads/{id}` → `whatsapp: {state: "none" | "open" | "closed" | "superseded" | "expired", conversation_id?, round?, open_facts?, opened_at?, closed_at?, last_error?, messages: {id, conversation_id, dir: "out" | "in", kind: "question" | "follow_up" | "closing" | "proposal" | "text" | "voice", text, at, facts?, stated?, unclear?, confidence?, transcript?}[]}`. `messages` keeps every conversation's messages. `GET /api/leads` rows add `whatsapp_state`.
- Provider contract (`engine/app/whatsapp/provider.py`): `number()` (digits it can reach, "" for any), `send(phone, text) → id`, `inbox(after) → {seq, phone, text, kind, media_path, media_mimetype}[]`, `cursor()`. `BridgeProvider` (the mini's bridge on 127.0.0.1:8013, pinned to one number) is live. `CloudApiProvider` (WhatsApp Business Cloud API, `WA_PROVIDER=cloud`) is a stub: it needs the installer's phone number id, a token and a reply webhook.

Complete and Send
- The approve endpoint is unchanged (hash, overrides, 409) and is now called Complete. `status` stays `"approved"` on the wire so existing readers keep working; every lead response and list row adds `status_label`: Draft, On a call, Ready, Complete, Sent, Signed, Declined, Question, Ended. The approve response carries `status_label: "Complete"`.
- `POST /api/leads/{id}/send` header `X-Intake-Secret`, body `{channel: "whatsapp" | "copy", base_version?}` → `{version, status: "sent", status_label: "Sent", sent: {channel, at, text, link}}`. `text` is Rina's message with the homeowner's first name and the link `<WEB_URL>/start/proposal/{lead_id}`. `whatsapp` sends it (logged in `whatsapp.messages` as kind `proposal`); `copy` only logs it for the web to copy. 409 unless the lead is Complete (or already Sent). Signing accepts `sent` as it accepts `approved`. A design change on a Sent lead releases it like an approved one; reset clears `sent`. A new Complete clears `sent`.

v2.14 additions (engine, restart A)
- Dry runs: `POST /api/leads/{id}/whatsapp/ask` and `POST /api/leads/{id}/send` take `dry: true` (body) or `?dry=1`. The Rina message is composed and logged in `whatsapp.messages` as kind `"dry"` (`purpose: "question" | "proposal"`). Nothing goes through the bridge, no poll starts, and send leaves the status unchanged. A dry ask sets `whatsapp.state: "dry"`. A later dry run replaces the earlier one, and a real ask or send removes it. Send dry works at any status.
- `layout_slots: string[]` is accepted in overrides (`/api/refine` validates it and ignores it for sizing; `POST /api/intake/step` stores it on the lead; `GET /api/leads/{id}` returns it in `overrides`). It is stored opaque. A `pv_kwp` override sizes economics for that count on the engine's own fill order (best face first, the first n slots of each face); the chosen slot ids are not interpreted.
- `POST /api/explain/layers` → `planes.planes[].slots: {id: "<face id>:<index>", face, corners: [x, y, z][4], placed: boolean}[]` on every target face: every position a module fits. `placed` marks the engine's layout, always the first n slots of a face.
- Every design response adds `rates: {pv_fixed_eur, pv_eur_per_kwp, battery_eur_per_kwh, wallbox_fixed_eur, heatpump_fixed_eur, heatpump_subsidy_share, heatpump_subsidy_cap_eur, heatpump_subsidy_eur, heatpump_boiler_avoided_eur, heatpump_net_eur, installation_eur: 0, installation_note, lines: {item, label, eur}[], total_eur}`. `lines` sum to `total_eur`, which equals `economics.capex_eur`. Installation sits inside each rate. The PV intercept is labelled "fixed cost per system".
- `PUT /api/leads/{id}/demo-state {decided_at?, clear?}` stores the lead as it is now as its demo state. `PUT /api/leads/{id}/reset` (and so reset-pinned) then restores exactly that: status, decision, approval, facts, draft, overrides, sent, WhatsApp thread. Phone stays. Without a demo state, reset goes back to creation as before.

v2.14 additions (engine, restart B: figure audit and WhatsApp polish)
- Replay (`GET /api/inbox`): drawn only from homes neither the ML board nor the rules-4 fit saw (the ML test board ∩ `planner_rules.split.test_ids()`), ordered by kind and installer only, never by whether the draft matched.
- One roof capacity: `RoofResult.max_panels` and `max_kwp` come from the 3D model's layout (every sunny face filled; hero 40 modules, 18 kWp) when the model is built, with `capacity_source: "layout"`; otherwise the area estimate with `capacity_source: "area estimate"`. The PV reason, layers and the caps all read it.
- Cash series on one basis: `economics.cashflow_yearly_eur`, `cashflow_cumulative_eur`, `break_even_year` and `irr` count the battery replacement exactly as the NPV does (cost at end of life, straight-line residual credited at year 20). `economics.battery_replacement: {years, cost_eur, residual_eur} | null`. Hero: €16,796 after 20 years, IRR 8.19 %, break-even year 10.
- "Pays back" means the break-even year everywhere it is read: explanation ("Breaks even in year N"), plausibility, variant notes ("breaks even N years sooner"), and the layers check (`name: "Break-even"`). `payback_years` stays a field.
- Heat-loss bar segments carry `share` (roof, walls, windows, floor, ventilation, thermal bridges; they sum to 1). `envelope.elements` already lists all six.
- Battery guide: HTW Berlin's upper guide, at most 1.5 kWh per 1,000 kWh of use and at most 1.5 kWh per kWp, the lower one (hero 7.5 kWh), beside the planners' median 1.1 to 1.2 kWh per kWp. The unsourced 0.7 to 1.0 band and the "63 %" are gone.
- One home-charging share: 80 % of the car's kWh at home in both the card (`ev.home_share`, `simulated_at_home_kwh`) and the simulation (assumption from Fraunhofer ISI's share of cars).
- `house_built_year` accepts a decade string ("1980s") on the intake step: stored as year 1985 plus `house_built_range: "1980 to 1989"`, source stated. `sources` comes from the creation facts, history answers and fact sources (not a value match).
- `boiler_age_years` joins the facts the engine can ask about.
- WhatsApp: one template set for ask and send, "Rina here from Isarwerk Solar" (the lead's `meta.installer_name` when set). First name from the lead name, "Hi there" for a test label or a non-name. Ask and send take `origin` (the web's request origin) and the link is built on it (`<origin>/start/proposal/{id}`; default https://marquee-home.vercel.app). `GET /api/leads/{id}/whatsapp/preview?kind=ask|send&origin=` returns `{kind, text, link?, open_facts?, asking?}`: exactly what would be sent, nothing logged. Dry runs return `text` too. `POST /api/leads/{id}/send` takes `text?` and sends exactly that. The preview route is pure. A dry run keeps at most one "dry" entry per kind (question, proposal), and the real ask or send replaces its dry entry. Real messages are never removed.
- `POST /api/leads` checks `phone` before anything is saved: a 422 leaves no lead behind. `POST /api/leads/hide-unpinned` marks every unpinned, non-test lead `test: true` (hidden from the board, still reachable by URL; no deletes) → `{hidden: {lead_id, customer_name}[], count}`.

v2.14 additions (engine, restart C: heat loss on the heated rooms)
- The envelope is corrected engine-side (`envelope_view.correct`, applied to every envelope the engine returns or sizes from): windows are 20 % of the heated floor area (footprint x storeys below the eaves x 0.72), not 20 % of every LoD2 wall including the gables. Ventilation runs on that floor area x 2.5 m, not the gross LoD2 volume with the roof space. Walls, roof, floor, U-values and thermal bridges are unchanged. `envelope.heated_area_m2`, `envelope.corrected: true`, `envelope.uncorrected` (the cached figures), `design.volume_m3` is the heated volume. Hero: 17.2 kW design heat load (was 21.2), 92 W/m² on 188 m², and 39,000 kWh a year (was 48,900). The heat pump is still sized from the bill when there is one (hero 8.7 kW); the envelope stays the upper bound.
- `RoofResult.floor_area_m2` and `storeys` come from the 3D model's eave height when the model is built (hero 188.5 m², 2 storeys, not 282.6 m² from the ridge), with `floor_area_note`.
- `GET /api/eval` → `qualification_backtest: {priority: 101, call_first: 23, decline: 2, n: 126, priority_share, call_first_share, decline_share, population, method, source, recomputed_live: false}`: 80 / 18 / 2 on the 126 sealed-half homes, a recorded result from the verifier's recomputation (not computed by the engine at request time).
- Config on the engine host only (`~/.config/marquee/engine.env`, loaded by `run.sh`; never in the repo): `MARQUEE_DEMO_PHONE` (the number set on pinned demo leads at start; unset, none is set) and `WA_BRIDGE_TO` (the bridge's pinned number; unset, every WhatsApp send fails with the reason).
- WhatsApp expiry: a conversation with no reply for 2 hours shows `state: "expired"`. For 24 hours after its last activity it still reads replies (the newest such conversation per phone, when none is open on that phone). A late reply reopens it (`reopened_at`) and is parsed as usual. A new ask on any lead is allowed once the old one is expired, and supersedes it.
- `GET /api/roof/model` takes `lead_id` (lays out that lead's own design kWp at its address and build year) and, when a kWp is known, returns `planes[].slots` exactly as layers does: `placed` marks the design's modules only (hero: 23 of 40). `layout_kwp` says which kWp the `chosen_panels` show; null means the model's own default fill (27 on the hero), which is not a design.

## v2.15 (engine 1d0266a, additive): SKU catalogue
- One catalogue for every installer, built from the parts file into aggregates only (brand, name, size, unit, share; no project rows): `GET /api/catalogue` → `{modules, inverters, batteries, wallboxes, heatpumps: {brand, name, size, unit, share}[]}`.
- Lead designs, variants and refines snap to the ladder the catalogue holds (battery 5 / 7 / 9 / 10 / 18 kWh, inverter 5 / 10 / 20 kW, heat pump 5.5 / 7.5 / 10.5 / 12.5 kW, modules in 463 W steps). The sealed exam, the live eval and the replay stay unsnapped.
- `design.components.<c>.sku: {brand, name, size, unit, share, brands: string[], modules?: number}`; `variants[].skus` and `lead.approved.skus` the same shape; `rates.lines[].sku`. Overrides accept `sku_<part>: "<brand>"` (inverter, battery, wallbox, heatpump, modules), stored on the lead like the other overrides.
- `variants[].layout: {modules_per_face: Record<face, number>, modules}`.
- Frozen drafts (completed, sent, decided) and approvals drafted before the catalogue get `skus` attached on read at their own sizes. `variants[].skus` is filled on every variant, with or without an address.

## v2.16 (engine, additive): why a part is left out
- `design.components.<battery | heatpump | wallbox>.none_reason: string | null`: a short phrase in product voice when the design leaves that part out, null when it is in. The sentence in `components.<c>.reason` is unchanged. `variants[].none_reasons: {battery, heatpump, wallbox}` carries the same phrases.
- Battery: "No PV to charge a battery" | "<x> kWp is too little PV for a battery" | "Planners here sign homes like this without one" | "Removed by the planner" | (variants) "Left out for the lowest upfront cost".
- Heat pump: "Already heats with a heat pump" | "Heating facts not asked yet" | "<District | Electric | ...> heating, no boiler to replace" | "No gas or oil boiler to replace" | "Boiler age not asked yet" | "<Gas | Oil> boiler from <year> still has years left" | "Removed by the planner" | "Not in this design".
- Wallbox: "Wallbox already installed" | "No electric car now or planned" | "Removed by the planner" | "Not in this design".
- A forced include never comes back none silently: an included heat pump is sized from the bill, the given heat or the default heat estimate, an included wallbox at 11 kW; if one still ends up none, `none_reason` says why. The web shows `none_reason` as the first line of a "No <part>" card, and nothing when the field is absent.
