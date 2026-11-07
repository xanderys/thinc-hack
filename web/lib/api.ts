// Copied from docs/api.md (v1). Change only when the contract changes.

export type InstallerId = "2a8ba8e2" | "23c108b7";
export type LoadProfile = "H0" | "FamilyOfFour" | "HomeOfficeOnePerson" | "FullTimeOnePerson" | "SeniorOnePerson" | "PartTimeOnePerson";
export type HeatingType = "Gas" | "Oil" | "Heatpump" | "OtherNonRenewable" | "OtherRenewable" | "Unknown";

export interface HomeInputs {
  installer_id: InstallerId;
  annual_demand_kwh: number;
  load_profile: LoadProfile;
  num_inhabitants?: number;
  house_size_sqm?: number;
  house_built_year?: number;
  has_ev: boolean;
  ev_annual_km?: number;
  has_wallbox: boolean;
  heating_type: HeatingType;
  heating_cost_per_year_eur?: number;
  heating_demand_kwh?: number;
  electricity_price_ct_kwh?: number;
  has_solar: boolean; existing_solar_kwp?: number;
  has_storage: boolean; existing_storage_kwh?: number;
}

export interface Design {
  pv_kwp: number | null;
  inverter_kw: number | null;
  battery_kwh: number | null;
  heatpump_kw: number | null;
  wallbox_kw: number | null;
}

export interface Neighbours { n: number; share_included: number; median_size: number | null; p25: number | null; p75: number | null; }

export interface ComponentDetail {
  decision: "include" | "none";
  size: number | null; unit: "kWp" | "kWh" | "kW";
  confidence: number;
  reason: string;
  alternatives: { size: number | null; label: string; share: number }[];
  neighbours: Neighbours;
}

export interface Plausibility { level: "ok" | "warn"; message: string; }

export interface Economics {
  capex_eur: number; annual_saving_eur: number; payback_years: number | null;
  self_consumption_share: number; autarky_share: number;
  assumptions: string[];
  method?: "hourly-simulation" | "annual-lookup";   // v1.2
  annual?: { pv_yield_kwh: number; load_kwh: number; self_consumed_kwh: number; fed_in_kwh: number; grid_import_kwh: number; feed_in_income_eur: number; bill_before_eur: number; bill_after_eur: number; npv_20y_eur: number | null };
}

export interface Optimum {               // v1.2
  design: Design;
  economics: Economics;
  delta_vs_proposal: { capex_eur: number; annual_saving_eur: number; payback_years: number | null; autarky_share: number };
  note: string;
}

export type ComponentKey = "pv" | "battery" | "heatpump" | "wallbox";

export interface DesignResponse {
  design: Design;
  explanation: string[];
  components: { pv: ComponentDetail; battery: ComponentDetail; heatpump: ComponentDetail; wallbox: ComponentDetail };
  plausibility: Plausibility[];
  economics: Economics;
  optimum?: Optimum;
  model_version: string;
}

export interface DiffItem { component: string; from: number | null; to: number | null; why: string; }
export type RefineResponse = DesignResponse & { diff: DiffItem[] };

export interface ValidateFlag { component: string; level: "ok" | "unusual" | "implausible"; message: string; neighbours: Neighbours; }
export interface ValidateResponse { flags: ValidateFlag[]; }

export interface Health { ok: true; model_version: string; trained_on: { projects: number; installers: number }; data_loaded: boolean; }

export interface ProjectSummary { project_id: string; installer_id: InstallerId; inputs: HomeInputs; expert: Design; }
export interface ProjectDetail { project_id: string; installer_id: InstallerId; inputs: HomeInputs; expert: Design; ours: DesignResponse; split?: string; }

export interface EvalComponent {
  decision_accuracy: number | null; baseline_decision_accuracy: number | null;
  size_mae: number | null; baseline_size_mae: number | null; unit: string;
  within_tolerance_share: number | null; tolerance: string;
  baseline_within_tolerance_share?: number | null; // engine extra
  ceiling_within_tolerance_share?: number; textbook_within_tolerance_share?: number; floor_slope_within_tolerance_share?: number; // v1.1
}

export interface Eval {
  split: { train: number; test: number; method: string };
  components: Record<ComponentKey, EvalComponent>;
  overall: { design_match_share: number; baseline_design_match_share: number; definition: string;
             ceiling_design_match_share?: number; textbook_design_match_share?: number; floor_slope_design_match_share?: number };
  ceiling?: { method: string; pv_agreement_share: number; battery_agreement_share: number };
  per_installer: Record<InstallerId, { test: number; design_match_share: number; baseline_design_match_share?: number }>;
  deviations: { project_id: string; component: string; ours: number | null; expert: number | null; note: string }[];
}

// Contract v1.1: an override value of "include" asks the engine to include and size the component.
export type OverrideValue = number | null | "include";
export type Overrides = Partial<Record<keyof Design, OverrideValue>>;

export interface InterpretChange { field: keyof HomeInputs; from: unknown; to: unknown; note: string; }
export interface InterpretOverride { field: keyof Design; from: OverrideValue | undefined; to: OverrideValue; note: string; }
export interface InterpretResponse { changes: InterpretChange[]; inputs: HomeInputs; overrides: InterpretOverride[]; }

export const COMPONENT_DESIGN_FIELD: Record<ComponentKey, keyof Design> = {
  pv: "pv_kwp", battery: "battery_kwh", heatpump: "heatpump_kw", wallbox: "wallbox_kw",
};
