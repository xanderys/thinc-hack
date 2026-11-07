// Stage fixtures. The hero lead is fictional; the Reality home is a real held-out project.
import type { HomeInputs, ReadResponse, WriteResponse } from "./api";

export const HERO_LEAD = `Hello,

we are a family of four in a 140 m² house built in 1985 at Katharinenstraße 5, 82008 Unterhaching. We heat with gas, which costs us about 2,400 euros a year, and we pay 37 cents per kWh for electricity. No electric car yet, no solar and no battery.

We would like an offer for solar with storage.

Best regards,
Katrin Huber`;

// What the lead states, plus the one fact it leaves out (annual use), answered as 5,000 kWh.
export const HERO_INPUTS: HomeInputs = {
  installer_id: "2a8ba8e2", address: "Katharinenstraße 5, 82008 Unterhaching", annual_demand_kwh: 5000, load_profile: "FamilyOfFour", num_inhabitants: 4,
  house_size_sqm: 140, house_built_year: 1985, heating_type: "Gas", heating_cost_per_year_eur: 2400,
  has_ev: false, has_wallbox: false, has_solar: false, has_storage: false, electricity_price_ct_kwh: 37,
};

export const HERO_SENTENCE = "The family buys an EV next year";

// Held-out, installer A, oil: PV and battery within tolerance, heat pump missed (the planner added one).
export const REALITY_PROJECT = "a2ceec0965e3f02b";

// Recorded real outputs, returned only when the Claude API fails (cached: true). Filled at rehearsal.
export const CACHED_READ: ReadResponse | null = {"inputs": {"address": "Katharinenstraße 5, 82008 Unterhaching", "num_inhabitants": 4, "load_profile": "FamilyOfFour", "house_size_sqm": 140, "house_built_year": 1985, "heating_type": "Gas", "heating_cost_per_year_eur": 2400, "electricity_price_ct_kwh": 37, "has_ev": false, "has_solar": false, "has_storage": false}, "found": [{"field": "address", "value": "Katharinenstraße 5, 82008 Unterhaching", "quote": "Katharinenstraße 5, 82008 Unterhaching"}, {"field": "num_inhabitants", "value": 4, "quote": "family of four"}, {"field": "load_profile", "value": "FamilyOfFour", "quote": "family of four"}, {"field": "house_size_sqm", "value": 140, "quote": "140 m² house"}, {"field": "house_built_year", "value": 1985, "quote": "built in 1985"}, {"field": "heating_type", "value": "Gas", "quote": "We heat with gas"}, {"field": "heating_cost_per_year_eur", "value": 2400, "quote": "about 2,400 euros a year"}, {"field": "electricity_price_ct_kwh", "value": 37, "quote": "37 cents per kWh"}, {"field": "has_ev", "value": false, "quote": "No electric car yet"}, {"field": "has_solar", "value": false, "quote": "no solar"}, {"field": "has_storage", "value": false, "quote": "no battery"}], "unknown": ["annual_demand_kwh"]};
export const CACHED_WRITE: Record<string, WriteResponse> = {};
