"use client";
import type { HeatingType, HomeInputs, InstallerId, LoadProfile } from "@/lib/api";

export const LOAD_PROFILES: Record<LoadProfile, string> = {
  H0: "Standard household (H0)", FamilyOfFour: "Family of four", HomeOfficeOnePerson: "One person, home office",
  FullTimeOnePerson: "One person, full time", SeniorOnePerson: "One person, retired", PartTimeOnePerson: "One person, part time",
};
export const HEATING: Record<HeatingType, string> = {
  Gas: "Gas", Oil: "Oil", Heatpump: "Heat pump", OtherNonRenewable: "Other, fossil", OtherRenewable: "Other, renewable", Unknown: "Unknown",
};
export const INSTALLERS: Record<InstallerId, string> = { "2a8ba8e2": "Installer 2a8ba8e2", "23c108b7": "Installer 23c108b7" };

type Props = { value: HomeInputs; onChange: (v: HomeInputs) => void };

function Num({ label, unit, value, onChange, min, max, step = 1, slider }: {
  label: string; unit: string; value: number | undefined; onChange: (v: number | undefined) => void;
  min: number; max: number; step?: number; slider?: boolean;
}) {
  const id = label.replace(/\W+/g, "-").toLowerCase();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="row">
        {slider && (
          <input type="range" aria-label={label} min={min} max={max} step={step} value={value ?? min}
            onChange={(e) => onChange(Number(e.target.value))} />
        )}
        <input id={id} type="number" min={min} max={max} step={step} value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
        <span className="unit">{unit}</span>
      </div>
    </div>
  );
}

export default function HomeForm({ value: v, onChange }: Props) {
  const set = <K extends keyof HomeInputs>(k: K, x: HomeInputs[K]) => onChange({ ...v, [k]: x });
  return (
    <form className="form" onSubmit={(e) => e.preventDefault()} aria-label="The home">
      <fieldset>
        <legend>Household</legend>
        <div className="field">
          <label htmlFor="installer">Installer style</label>
          <select id="installer" value={v.installer_id} onChange={(e) => set("installer_id", e.target.value as InstallerId)}>
            {Object.entries(INSTALLERS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <Num label="Annual demand" unit="kWh" slider min={1000} max={15000} step={100} value={v.annual_demand_kwh}
          onChange={(x) => set("annual_demand_kwh", x ?? 0)} />
        <div className="field">
          <label htmlFor="profile">Load profile</label>
          <select id="profile" value={v.load_profile} onChange={(e) => set("load_profile", e.target.value as LoadProfile)}>
            {Object.entries(LOAD_PROFILES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div className="pair">
          <Num label="Inhabitants" unit="" min={1} max={12} value={v.num_inhabitants} onChange={(x) => set("num_inhabitants", x)} />
          <Num label="Floor area" unit="m²" min={30} max={600} value={v.house_size_sqm} onChange={(x) => set("house_size_sqm", x)} />
        </div>
        <Num label="Year built" unit="" min={1850} max={2026} value={v.house_built_year} onChange={(x) => set("house_built_year", x)} />
      </fieldset>

      <fieldset>
        <legend>Mobility</legend>
        <label className="check"><input type="checkbox" checked={v.has_ev} onChange={(e) => onChange({ ...v, has_ev: e.target.checked, ev_annual_km: e.target.checked ? v.ev_annual_km ?? 12000 : v.ev_annual_km })} />Electric car</label>
        {v.has_ev && (
          <Num label="Distance driven" unit="km a year" slider min={2000} max={40000} step={1000} value={v.ev_annual_km} onChange={(x) => set("ev_annual_km", x)} />
        )}
        <label className="check"><input type="checkbox" checked={v.has_wallbox} onChange={(e) => set("has_wallbox", e.target.checked)} />Wallbox already installed</label>
      </fieldset>

      <fieldset>
        <legend>Heating</legend>
        <div className="field">
          <label htmlFor="heating">Current heating</label>
          <select id="heating" value={v.heating_type} onChange={(e) => set("heating_type", e.target.value as HeatingType)}>
            {Object.entries(HEATING).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      </fieldset>

      <fieldset>
        <legend>Already on the house</legend>
        <label className="check"><input type="checkbox" checked={v.has_solar} onChange={(e) => set("has_solar", e.target.checked)} />Solar</label>
        {v.has_solar && <Num label="Existing solar" unit="kWp" min={0} max={40} step={0.1} value={v.existing_solar_kwp} onChange={(x) => set("existing_solar_kwp", x)} />}
        <label className="check"><input type="checkbox" checked={v.has_storage} onChange={(e) => set("has_storage", e.target.checked)} />Battery</label>
        {v.has_storage && <Num label="Existing battery" unit="kWh" min={0} max={40} step={0.5} value={v.existing_storage_kwh} onChange={(x) => set("existing_storage_kwh", x)} />}
      </fieldset>

      <fieldset>
        <legend>Tariff</legend>
        <Num label="Electricity price" unit="ct/kWh" slider min={15} max={60} step={0.5} value={v.electricity_price_ct_kwh ?? 32}
          onChange={(x) => set("electricity_price_ct_kwh", x)} />
      </fieldset>
    </form>
  );
}
