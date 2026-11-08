// MOCK ENGINE. Fixtures only, active when ENGINE_URL=mock. Not the model.
// Rules follow docs/domain.md so the shapes and magnitudes are plausible.

import type {
  ComponentDetail, Design, DesignResponse, DiffItem, Eval, HomeInputs, InstallerId,
  Neighbours, ProjectDetail, ProjectSummary, RefineResponse, ValidateResponse, Health, AskResponse, InboxRow,
} from "./api";

export const MOCK_VERSION = "mock-0";

const round = (x: number, step: number) => Math.round(x / step) * step;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function evKwh(i: HomeInputs) { return i.has_ev ? Math.round((i.ev_annual_km ?? 12000) * 0.2) : 0; }
function hpKwh(i: HomeInputs) {
  if (i.heating_type === "Heatpump") return 0;
  const old = (i.house_built_year ?? 1985) < 1995;
  return (i.house_size_sqm ?? 140) * (old ? 40 : 25);
}

function wantsHeatpump(i: HomeInputs) {
  return i.heating_type === "Gas" || i.heating_type === "Oil" || i.heating_type === "OtherNonRenewable";
}

function neighbours(n: number, share: number, median: number | null, spread: number): Neighbours {
  return {
    n, share_included: share, median_size: median,
    p25: median == null ? null : round(median * (1 - spread), 0.5),
    p75: median == null ? null : round(median * (1 + spread), 0.5),
  };
}

function baseDesign(i: HomeInputs): Design {
  const hp = wantsHeatpump(i);
  const totalMwh = (i.annual_demand_kwh + evKwh(i) + (hp ? hpKwh(i) : 0)) / 1000;
  const style = i.installer_id === "2a8ba8e2" ? 1.15 : 1.0;
  let pv = round(Math.min(20, Math.max(4, totalMwh * 1.3 * style)), 0.5);
  if (i.has_solar && i.existing_solar_kwp) pv = round(Math.max(0, pv - i.existing_solar_kwp), 0.5);
  const battery = i.has_storage || i.annual_demand_kwh < 2500 ? null : round(Math.min(pv * 1.2, totalMwh * 1.1), 2.5) || null;
  const heatpump = hp ? round(((i.house_size_sqm ?? 140) * ((i.house_built_year ?? 1985) < 1995 ? 80 : 45)) / 1000 + 1, 1) : null;
  const wallbox = i.has_ev && !i.has_wallbox ? 11 : null;
  return { pv_kwp: pv || null, inverter_kw: pv ? round(pv / 1.2, 1) : null, battery_kwh: battery, heatpump_kw: heatpump, wallbox_kw: wallbox };
}

function detail(unit: ComponentDetail["unit"], size: number | null, confidence: number, reason: string, nb: Neighbours, alts: ComponentDetail["alternatives"]): ComponentDetail {
  return { decision: size == null ? "none" : "include", size, unit, confidence, reason, alternatives: alts, neighbours: nb };
}

function respond(i: HomeInputs, d: Design, fixed: Partial<Design> = {}): DesignResponse {
  const totalKwh = i.annual_demand_kwh + evKwh(i) + (d.heatpump_kw ? hpKwh(i) : 0);
  const pv = d.pv_kwp ?? 0, bat = d.battery_kwh ?? 0;
  const gen = pv * 950;
  const sc = gen === 0 ? 0 : Math.min(0.85, (bat > 0 ? 0.3 + Math.min(0.35, bat / Math.max(pv, 1) * 0.3) : 0.3) * Math.min(1.6, totalKwh / Math.max(gen, 1)) );
  const selfUsed = gen * sc;
  const aut = totalKwh === 0 ? 0 : Math.min(0.9, selfUsed / totalKwh);
  const price = (i.electricity_price_ct_kwh ?? 32) / 100;
  const saving = Math.round(selfUsed * price + (gen - selfUsed) * 0.077);
  const capex = Math.round(pv * 1250 + bat * 450 + (d.heatpump_kw ? 32000 : 0) + (d.wallbox_kw ? 1100 : 0));
  const pvCapex = pv * 1250 + bat * 450;
  const pb = saving > 0 ? Math.round((pvCapex / saving) * 10) / 10 : null;
  const n = 120 + (i.annual_demand_kwh % 37);
  const isFixed = (k: keyof Design) => k in fixed;

  const plaus: DesignResponse["plausibility"] = [];
  if (pv > 0 && bat > pv * 1.5) plaus.push({ level: "warn", message: `Battery ${bat} kWh is more than 1.5 times PV ${pv} kWp; most of it will sit idle.` });
  if (pb != null && (pb < 5 || pb > 15)) plaus.push({ level: "warn", message: `Payback of ${pb} years is outside the usual 5 to 15 year band.` });
  if (pv > 20) plaus.push({ level: "warn", message: `${pv} kWp is above what single-family roofs usually carry.` });
  if (plaus.length === 0) plaus.push({ level: "ok", message: "Sizes sit inside the ranges seen for similar homes." });

  return {
    design: d,
    explanation: [
      `Total demand is about ${Math.round(totalKwh).toLocaleString("en-GB")} kWh a year including EV and heat pump.`,
      `PV is sized near 1.3 kWp per 1,000 kWh, the middle of this installer's practice.`,
      bat ? `A ${bat} kWh battery covers the typical evening load.` : `No battery: demand is too low for one to pay back.`,
    ],
    components: {
      pv: detail("kWp", d.pv_kwp, isFixed("pv_kwp") ? 1 : 0.78,
        isFixed("pv_kwp") ? "Fixed by the planner." : `About 1.3 kWp per 1,000 kWh of total demand, as similar homes from this installer.`,
        neighbours(n, 1, d.pv_kwp, 0.2), [{ size: d.pv_kwp ? d.pv_kwp + 2 : null, label: "Larger roof use", share: 0.22 }]),
      battery: detail("kWh", d.battery_kwh, isFixed("battery_kwh") ? 1 : 0.64,
        isFixed("battery_kwh") ? "Fixed by the planner." : d.battery_kwh ? `Roughly 1 kWh per kWp, matching evening and morning use.` : i.has_storage ? "Existing storage already covers the evening load." : `Demand under 2,500 kWh rarely justifies a battery.`,
        neighbours(n, 0.71, d.battery_kwh ?? 10, 0.25), [{ size: null, label: "No battery", share: 0.29 }]),
      heatpump: detail("kW", d.heatpump_kw, isFixed("heatpump_kw") ? 1 : 0.58,
        isFixed("heatpump_kw") ? "Fixed by the planner." : d.heatpump_kw ? `Heat load from floor area and build year, plus 1 kW for hot water.` : `Heating is already renewable or unknown, so no heat pump is proposed.`,
        neighbours(Math.round(n * 0.4), 0.34, d.heatpump_kw ?? 9, 0.2), [{ size: null, label: "Keep current heating", share: 0.66 }]),
      wallbox: detail("kW", d.wallbox_kw, isFixed("wallbox_kw") ? 1 : 0.9,
        isFixed("wallbox_kw") ? "Fixed by the planner." : d.wallbox_kw ? `11 kW is the standard size that needs only registration.` : i.has_ev ? "A wallbox is already installed." : "No EV, so no wallbox.",
        neighbours(n, i.has_ev ? 0.88 : 0.07, 11, 0), [{ size: 22, label: "22 kW with grid approval", share: 0.06 }]),
    },
    plausibility: plaus,
    economics: {
      capex_eur: capex, annual_saving_eur: saving, payback_years: pb,
      self_consumption_share: Math.round(sc * 100) / 100, autarky_share: Math.round(aut * 100) / 100,
      assumptions: [
        `Electricity ${Math.round(price * 100)} ct/kWh, feed-in 7.7 ct/kWh.`,
        "Yield 950 kWh per kWp per year.",
        "PV 1,250 EUR/kWp, battery 450 EUR/kWh, heat pump 32,000 EUR before subsidy.",
        "Payback counts PV and battery only.",
      ],
    },
    model_version: MOCK_VERSION,
    optimum: d.pv_kwp == null ? undefined : {
      design: { ...d, pv_kwp: d.pv_kwp + 2, battery_kwh: d.battery_kwh == null ? null : Math.max(5, d.battery_kwh - 2.5) },
      economics: { capex_eur: capex + 1300, annual_saving_eur: saving + 240, payback_years: pb == null ? null : Math.round((pb - 0.8) * 10) / 10, self_consumption_share: sc, autarky_share: Math.min(0.9, aut + 0.04), assumptions: [], method: "hourly-simulation" },
      delta_vs_proposal: { capex_eur: 1300, annual_saving_eur: 240, payback_years: pb == null ? null : -0.8, autarky_share: 0.04 },
      note: "Mock: more PV and a smaller battery pay back sooner here.",
    },
  };
}

export function mockDesign(inputs: HomeInputs): DesignResponse {
  return respond(inputs, baseDesign(inputs));
}

const LABEL: Record<keyof Design, string> = { pv_kwp: "pv", inverter_kw: "inverter", battery_kwh: "battery", heatpump_kw: "heatpump", wallbox_kw: "wallbox" };

const INCLUDE_DEFAULT: Design = { pv_kwp: 8, inverter_kw: 7, battery_kwh: 10, heatpump_kw: 9, wallbox_kw: 11 };

export function mockRefine(inputs: HomeInputs, raw: Partial<Record<keyof Design, number | null | "include">> = {}): RefineResponse {
  const free = baseDesign(inputs);
  const overrides: Partial<Design> = {};
  for (const [k, v] of Object.entries(raw) as [keyof Design, number | null | "include"][]) overrides[k] = v === "include" ? free[k] ?? INCLUDE_DEFAULT[k] : v;
  const d: Design = { ...free, ...overrides };
  // Re-size the rest around fixed components.
  if ("pv_kwp" in overrides && !("battery_kwh" in overrides) && d.battery_kwh != null && d.pv_kwp != null) {
    d.battery_kwh = round(Math.min(d.battery_kwh, d.pv_kwp * 1.2), 2.5) || null;
  }
  if ("battery_kwh" in overrides && overrides.battery_kwh == null && !("pv_kwp" in overrides) && d.pv_kwp != null) {
    d.pv_kwp = round(d.pv_kwp * 0.9, 0.5);
  }
  if (!("inverter_kw" in overrides)) d.inverter_kw = d.pv_kwp ? round(d.pv_kwp / 1.2, 1) : null;
  const diff: DiffItem[] = [];
  (Object.keys(d) as (keyof Design)[]).forEach((k) => {
    if (d[k] !== free[k]) diff.push({
      component: LABEL[k], from: free[k], to: d[k],
      why: k in overrides ? "Fixed by the planner." : k === "inverter_kw" ? "Inverter follows PV at a 1.2 DC/AC ratio." : k === "battery_kwh" ? "Battery capped near 1.2 kWh per kWp." : "PV trimmed when there is no battery to store midday surplus.",
    });
  });
  return { ...respond(inputs, d, overrides), diff };
}

export function mockValidate(inputs: HomeInputs, design: Design): ValidateResponse {
  const r = respond(inputs, design);
  return {
    flags: (["pv", "battery", "heatpump", "wallbox"] as const).map((c) => ({
      component: c, level: "ok" as const, message: "Within the range of similar homes.", neighbours: r.components[c].neighbours,
    })),
  };
}

export function mockHealth(): Health {
  return { ok: true, model_version: MOCK_VERSION, trained_on: { projects: 0, installers: 2 }, data_loaded: false };
}

const PROFILES = ["H0", "FamilyOfFour", "HomeOfficeOnePerson", "FullTimeOnePerson", "SeniorOnePerson"] as const;
const HEATING = ["Gas", "Oil", "Heatpump", "Unknown", "Gas"] as const;

function projects(): ProjectSummary[] {
  const r = rng(7);
  return Array.from({ length: 40 }, (_, k) => {
    const installer: InstallerId = k % 3 === 0 ? "23c108b7" : "2a8ba8e2";
    const ev = r() < 0.35;
    const inputs: HomeInputs = {
      installer_id: installer,
      annual_demand_kwh: Math.round((2200 + r() * 5800) / 100) * 100,
      load_profile: PROFILES[Math.floor(r() * PROFILES.length)],
      num_inhabitants: 1 + Math.floor(r() * 5),
      house_size_sqm: Math.round(90 + r() * 120),
      house_built_year: Math.round(1960 + r() * 60),
      has_ev: ev, ev_annual_km: ev ? Math.round((8000 + r() * 12000) / 1000) * 1000 : undefined,
      has_wallbox: false,
      heating_type: HEATING[Math.floor(r() * HEATING.length)],
      has_solar: false, has_storage: false,
    };
    const ours = baseDesign(inputs);
    const jitter = (x: number | null, s: number, step: number) => x == null ? null : round(Math.max(step, x + (r() - 0.5) * 2 * s), step);
    const expert: Design = {
      pv_kwp: jitter(ours.pv_kwp, 2, 0.5),
      inverter_kw: jitter(ours.inverter_kw, 1.5, 1),
      battery_kwh: r() < 0.15 ? (ours.battery_kwh ? null : 10) : jitter(ours.battery_kwh, 3, 2.5),
      heatpump_kw: r() < 0.2 ? (ours.heatpump_kw ? null : 8) : jitter(ours.heatpump_kw, 2, 1),
      wallbox_kw: ours.wallbox_kw,
    };
    return { project_id: `mock-${(k + 101).toString(36)}${installer.slice(0, 2)}`, installer_id: installer, inputs, expert };
  });
}

let cached: ProjectSummary[] | null = null;
export function mockProjects(limit = 50): ProjectSummary[] {
  cached ??= projects();
  return cached.slice(0, limit);
}

export function mockProject(id: string): ProjectDetail | null {
  const p = mockProjects(1000).find((x) => x.project_id === id);
  return p ? { ...p, ours: mockDesign(p.inputs) } : null;
}

export function mockEval(): Eval {
  const ps = mockProjects(1000);
  return {
    split: { train: 0, test: ps.length, method: "Mock fixtures, no real split" },
    components: {
      pv: { decision_accuracy: 0.97, baseline_decision_accuracy: 0.97, size_mae: 1.1, baseline_size_mae: 2.4, unit: "kWp", within_tolerance_share: 0.62, tolerance: "±1 kWp" },
      battery: { decision_accuracy: 0.83, baseline_decision_accuracy: 0.71, size_mae: 1.9, baseline_size_mae: 3.2, unit: "kWh", within_tolerance_share: 0.55, tolerance: "±2.5 kWh" },
      heatpump: { decision_accuracy: 0.8, baseline_decision_accuracy: 0.66, size_mae: 1.4, baseline_size_mae: 2.6, unit: "kW", within_tolerance_share: 0.58, tolerance: "±2 kW" },
      wallbox: { decision_accuracy: 0.95, baseline_decision_accuracy: 0.9, size_mae: 0.3, baseline_size_mae: 0.8, unit: "kW", within_tolerance_share: 0.93, tolerance: "exact" },
    },
    overall: { design_match_share: 0.41, baseline_design_match_share: 0.19, definition: "Every component within tolerance and every include or none decision correct." },
    per_installer: {
      "2a8ba8e2": { test: ps.filter((p) => p.installer_id === "2a8ba8e2").length, design_match_share: 0.44 },
      "23c108b7": { test: ps.filter((p) => p.installer_id === "23c108b7").length, design_match_share: 0.36 },
    },
    deviations: ps.slice(0, 8).map((p, k) => {
      const ours = baseDesign(p.inputs);
      const c = (["pv_kwp", "battery_kwh", "heatpump_kw"] as const)[k % 3];
      return { project_id: p.project_id, component: LABEL[c], ours: ours[c], expert: p.expert[c], note: "Mock deviation." };
    }),
  };
}

const TOL = { pv: (a: number, b: number) => Math.abs(a - b) <= Math.max(1, 0.15 * b), battery: (a: number, b: number) => Math.abs(a - b) <= 2 };
const near = (a: number | null, b: number | null, f?: (a: number, b: number) => boolean) => (a == null) === (b == null) && (a == null || b == null || !f || f(a, b));

export function mockAsk(inputs: HomeInputs, unknown?: (keyof HomeInputs)[]): AskResponse {
  const can = (f: keyof HomeInputs) => unknown ? unknown.includes(f) : true;
  if (!can("annual_demand_kwh")) return { questions: [] };
  const options = [3000, 5000, 6500].map((v) => ({ value: v, label: `about ${v.toLocaleString("en-GB")} kWh`, design: baseDesign({ ...inputs, annual_demand_kwh: v }) }));
  return { questions: [{ field: "annual_demand_kwh", current: inputs.annual_demand_kwh, options, spread: 1.8 }] };
}

export function mockInbox(limit = 20): InboxRow[] {
  return mockProjects(limit).map((p) => {
    const d = baseDesign(p.inputs), e = p.expert;
    const w = { pv: near(d.pv_kwp, e.pv_kwp, TOL.pv), battery: near(d.battery_kwh, e.battery_kwh, TOL.battery), heatpump: near(d.heatpump_kw, e.heatpump_kw), wallbox: near(d.wallbox_kw, e.wallbox_kw) };
    const all = w.pv && w.battery && w.heatpump && w.wallbox;
    return { project_id: p.project_id, installer_id: p.installer_id, label: `${p.inputs.annual_demand_kwh.toLocaleString("en-GB")} kWh`, inputs: p.inputs, draft: d, confidence: 0.6, expert: e, within: { ...w, all }, note: all ? "" : "Mock deviation." };
  });
}
