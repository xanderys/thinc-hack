# Engine API contract (v1.3)

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
}

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
}

interface Plausibility { level: "ok" | "warn"; message: string; }

interface Economics {
  capex_eur: number; annual_saving_eur: number; payback_years: number | null;
  self_consumption_share: number; autarky_share: number;
  assumptions: string[];
  method?: "hourly-simulation" | "annual-lookup";   // v1.2
  annual?: { pv_yield_kwh: number; load_kwh: number; self_consumed_kwh: number; fed_in_kwh: number; grid_import_kwh: number; feed_in_income_eur: number; bill_before_eur: number; bill_after_eur: number; npv_20y_eur: number | null };
}

interface Optimum {                        // v1.2, from the hourly physics simulation
  design: Design;                         // economically optimal sizes for this home under the installer's catalogue
  economics: Economics;
  delta_vs_proposal: { capex_eur: number; annual_saving_eur: number; payback_years: number | null; autarky_share: number };
  note: string;                           // one sentence: where the expert habit and the maths disagree
}

interface DesignResponse {
  design: Design;
  explanation: string[];                // 3 to 5 short sentences
  components: { pv: ComponentDetail; battery: ComponentDetail; heatpump: ComponentDetail; wallbox: ComponentDetail };
  plausibility: Plausibility[];
  economics: Economics;                 // v1.2: from the hourly simulation when available; economics.method says which
  optimum?: Optimum;
  model_version: string;
}
```

## Endpoints

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
}
```

## v1.3 additions (LLM-free, additive)

- `POST /api/ask` body `{ inputs: HomeInputs }` → `{ questions: { field: keyof HomeInputs; current: unknown; options: { value: unknown; label: string; design: Design }[]; spread: number }[] }`, sorted by spread, top 3, empty when nothing moves. Candidates: `heating_type` Unknown → Gas | Heatpump; `has_ev` false → true at 12,000 km; `annual_demand_kwh` absent or the 4,500 default → 3,000 | 6,500; `heating_demand_kwh` missing on a fossil home → 12,000 | 20,000; `has_solar` false → true at 6 kWp. spread = Σ |Δsize| / tolerance (1 kWp, 2 kWh, 2 kW) plus 1 per decision flip, max over options.
- `GET /api/inbox?limit=20` → `{ project_id, installer_id, label, inputs: HomeInputs, draft: Design, confidence: number, expert: Design, within: { pv: boolean; battery: boolean; heatpump: boolean; wallbox: boolean; all: boolean }, note: string }[]` from the test split in demo order (varied installers, EV, heating; the first row a PV and battery hit); confidence = mean confidence of included components; `within` by the eval tolerances; `note` = the deviation note when `all` is false, else "".

Natural-language refinement ("the family buys an EV next year") is handled in `web/` (`POST /api/interpret` → `{ changes: { field, from, to, note }[], inputs: HomeInputs }`) with the Claude API, then `web/` calls `/api/refine`. The engine has no LLM.

Errors: non-2xx with `{ error: string }` in the source's own words.
