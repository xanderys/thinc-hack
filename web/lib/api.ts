// Copied from docs/api.md (v1.6). Change only when the contract changes.

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
  address?: string;   // v1.6
  preference?: "independence" | "payback" | "upfront";   // v1.7, reorders variants only
  roof?: RoofResult;  // v1.6
}

export interface RoofResult {
  source: "lod2" | "google-solar" | "osm" | "postcode" | "none";
  matched_address: string; lat: number | null; lon: number | null;
  footprint_m2: number | null; roof_area_m2: number | null; usable_area_m2: number | null;
  segments: { azimuth: number; pitch: number; area_m2: number }[];
  max_panels: number | null; max_kwp: number | null;
  confidence: "measured" | "footprint" | "estimate" | "none"; notes: string[];
  pending?: boolean;   // the LoD2 measurement is still running; ask again in a few seconds
  floor_area_m2?: number | null; storeys?: number | null; floor_area_confidence?: "estimate";   // v1.6.1, upper bound
  geometry?: { footprint_m2?: number | null; storeys?: number | null; height_m?: number | null; large_building?: boolean | null; source?: string; note?: string } | null; // v2.11: LoD2, outranks dwellings_class
  build_year_class?: string | null; build_year_estimate?: number | null; heating_class?: string | null; zensus_confidence?: string; // heating_class is the system type, never the fuel
}

export interface Derivation {   // v1.5
  axiom: string; equation: string;
  inputs: { name: string; value: number | string; unit: string; source: string }[];
  axiom_result: number | null;
  adjustment: { label: string; value: number; n_similar?: number | null } | null;
  final: number | null;
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
  derivation?: Derivation; // v1.5
}

export interface Plausibility { level: "ok" | "warn"; message: string; }

export interface Economics {
  capex_eur: number; annual_saving_eur: number; payback_years: number | null;
  self_consumption_share: number; autarky_share: number;
  assumptions: string[];
  method?: "hourly-simulation" | "annual-lookup";   // v1.2
  break_even_year?: number | null; irr?: number | null;   // undiscounted break-even and IRR (physics)
  annual?: { pv_yield_kwh: number; load_kwh: number; self_consumed_kwh: number; fed_in_kwh: number; grid_import_kwh: number; feed_in_income_eur: number; bill_before_eur: number; bill_after_eur: number; npv_20y_eur: number | null;
    battery_charged_kwh?: number; battery_discharged_kwh?: number; ev_charge_kwh?: number; ev_from_pv_kwh?: number; home_from_pv_kwh?: number }; // v1.3.1
}

export interface Optimum {               // v1.2
  design: Design;
  economics: Economics;
  delta_vs_proposal: { capex_eur: number; annual_saving_eur: number; payback_years: number | null; autarky_share: number };
  note: string;
}

export type ComponentKey = "pv" | "battery" | "heatpump" | "wallbox";

export interface Variant {   // v1.7
  key: "expert" | "value" | "independence" | "payback" | "upfront";
  label: string; design: Design; economics: Economics; note: string;
}

export interface DesignResponse {
  design: Design;
  explanation: string[];
  components: { pv: ComponentDetail; battery: ComponentDetail; heatpump: ComponentDetail; wallbox: ComponentDetail };
  plausibility: Plausibility[];
  economics: Economics;
  optimum?: Optimum;
  variants?: Variant[];   // v1.7
  rules?: Rule[];         // v2.0
  model_version: string;
}

// v2.0: the named planner rules that produced a design.
export interface RuleConstant { name: string; value: number | string | (number | string)[]; unit: string; source: string; fitted_on?: string | null; }
// rules-5 (7 Nov evening): rows carry textbook, rule and design instead of constants; both shapes render.
export interface Rule {
  name: string; sentence: string; constants?: RuleConstant[];
  textbook?: { value: number | null; unit: string; source: string; url?: string } | null;
  rule?: { engine: string; text: string } | null;
  design?: { value: number | null; unit: string } | null;
}
export interface RecommenderScore { design_match_share: number; pv_within: number; battery_within: number; wallbox_decision: number; }
export interface DeviationQuality { n_differ: number; ours_better_payback: number; expert_better_payback: number; ours_better_autarky: number; expert_better_autarky: number; method: string; }

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
  synthetic?: Synthetic;
  recommenders?: Partial<Record<"formula" | "blackbox" | "textbook", RecommenderScore>>;  // v2.0
  deviation_quality?: DeviationQuality;                                                   // v2.0
}

export interface Synthetic {
  n: number; plausible_share: number; monotonicity_violations: number; headline: string; headline_short: string;
  invariants: { name: string; group: string; pass_share: number; n_checked: number }[];
  before?: { pass_share: Record<string, number> };
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

// v1.3
export interface AskOption { value: unknown; label: string; design: Design; }
export interface AskQuestion { field: keyof HomeInputs; current: unknown; options: AskOption[]; spread: number; }
export interface AskResponse { questions: AskQuestion[]; }

export interface InboxRow {
  project_id: string; installer_id: InstallerId; label: string; inputs: HomeInputs; draft: Design; confidence: number; expert: Design;
  within: { pv: boolean; battery: boolean; heatpump: boolean; wallbox: boolean; all: boolean }; note: string;
}

// LLM edge, web only
export interface ReadFact { field: keyof HomeInputs | "wants" | "monthly_bill_eur" | "postcode"; value: unknown; quote: string; }
export interface ReadResponse { inputs: Partial<HomeInputs>; found: ReadFact[]; unknown: (keyof HomeInputs)[]; cached?: boolean; source?: "call"; origin?: Record<string, "form" | "call" | "estimated">; postcode?: string; }
export interface WriteResponse { text: string; grounded: boolean; lines: Partial<Record<ComponentKey, string | null>>; cached?: boolean; }

export const INSTALLER_NAME: Record<InstallerId, string> = { "2a8ba8e2": "Installer A", "23c108b7": "Installer B" };

// v1.9: the engine runs the call, one rolling draft per lead.
export interface LeadChange { component: string; from: number | null; to: number | null; why: string; }
export interface NextQuestion { field: string; question: string; why: string; options?: { value: unknown; label: string }[]; expected_swing: string; }
export interface LeadCreated { lead_id: string; draft: DesignResponse; facts: HomeInputs; unknown: string[]; next_question: NextQuestion | null; }
export interface Lead {
  lead_id: string; status: LeadStatus; customer_name: string; address_or_postcode: string;
  facts: HomeInputs; draft: DesignResponse;
  history: { step: number; field: string; answer: unknown; changed: LeadChange[]; at: string }[];
  next_question: NextQuestion | null; questions_asked: number; created_at: string; updated_at: string;
  version?: number;   // optimistic concurrency: writes carry it back as base_version
  proposal_hash?: string; approved_at?: string | null; approved_variant?: Variant["key"] | null; decision?: LeadDecision | null;   // v2.5
}
// v2.5: homeowner decision (demo acceptance, not a qualified e-signature).
export type LeadStatus = "draft" | "in_call" | "done" | "approved" | "signed" | "declined" | "question";
export type DecisionAction = "sign" | "decline" | "question";
export interface LeadDecision { action: DecisionAction; name?: string | null; decided_at: string; proposal_hash: string; has_signature: boolean; matches_current: boolean; question?: string | null; }
export interface ApproveResponse { status: "approved"; approved_at: string; approved_variant: Variant["key"] | null; proposal_hash: string; }
export interface DecisionBody { action: DecisionAction; name?: string; accepted?: boolean; signature_png?: string; question?: string; proposal_hash: string; }
export interface DecisionResponse { ok: boolean; status: LeadStatus; decided_at: string; proposal_hash: string; }
export interface LeadRow { lead_id: string; status: Lead["status"]; title: string; customer_name?: string; address_or_postcode?: string; created_at?: string; decision?: LeadDecision | null; proposal_hash?: string; }
export interface Priors { n_steps_logged: number; order: { field: string; mean_swing: number; times_asked: number }[]; }
