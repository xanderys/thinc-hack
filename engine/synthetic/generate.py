"""Synthetic homes from the real training inputs: 70% in-distribution, 20% edge, 10% adversarial. Fixed seed."""
import numpy as np

from app.data import INPUT_KEYS
from app.model import row_inputs

SEED = 20261107
SPLIT = {"in_distribution": 0.7, "edge": 0.2, "adversarial": 0.1}
EDGE_KINDS = ["demand_low", "demand_high", "ev_30000_km", "heatpump_and_ev", "existing_solar"]
ADV_KINDS = ["demand_0", "demand_50000", "price_0", "small_house_high_demand", "solar_kwp_without_solar",
             "ev_km_without_ev", "storage_without_solar", "negative_demand"]


def _clean(r: dict) -> dict:
    return {k: r.get(k) for k in ["installer_id", "offer_date", *INPUT_KEYS]}


def _perturb(h: dict, rng) -> dict:
    """Within realistic ranges; the joint structure comes from the real row drawn."""
    h = dict(h)
    d = h["annual_demand_kwh"]
    if d != 4500:  # keep the pack's 4,500 kWh default as a default
        h["annual_demand_kwh"] = float(np.clip(round(d * rng.lognormal(0, 0.12), -1), 500, 30000))
    if h.get("ev_annual_km"):
        h["ev_annual_km"] = float(np.clip(round(h["ev_annual_km"] * rng.lognormal(0, 0.15), -2), 2000, 40000))
    for k, sd in (("electricity_price_ct_kwh", 0.08), ("heating_demand_kwh", 0.15), ("heating_cost_per_year_eur", 0.15),
                  ("existing_solar_kwp", 0.1), ("house_size_sqm", 0.1)):
        if h.get(k):
            h[k] = round(float(h[k] * rng.lognormal(0, sd)), 1)
    return h


def _edge(h: dict, kind: str, rng) -> dict:
    h = dict(h)
    if kind == "demand_low":
        h["annual_demand_kwh"] = float(round(rng.uniform(1500, 2500), -1))
    elif kind == "demand_high":
        h["annual_demand_kwh"] = float(round(np.exp(rng.uniform(np.log(10000), np.log(20000))), -1))
    elif kind == "ev_30000_km":
        h.update(has_ev=True, ev_annual_km=30000.0)
    elif kind == "heatpump_and_ev":
        h.update(heating_type="Heatpump", has_ev=True, ev_annual_km=h.get("ev_annual_km") or 12000.0)
    elif kind == "existing_solar":
        h.update(has_solar=True, existing_solar_kwp=float(round(rng.uniform(3, 15), 1)))
    return h


def _adversarial(h: dict, kind: str, rng) -> dict:
    h = dict(h)
    if kind == "demand_0":
        h["annual_demand_kwh"] = 0.0
    elif kind == "demand_50000":
        h["annual_demand_kwh"] = 50000.0
    elif kind == "price_0":
        h["electricity_price_ct_kwh"] = 0.0
    elif kind == "small_house_high_demand":
        h.update(house_size_sqm=40.0, annual_demand_kwh=10000.0)
    elif kind == "solar_kwp_without_solar":
        h.update(has_solar=False, existing_solar_kwp=float(round(rng.uniform(5, 12), 1)))
    elif kind == "ev_km_without_ev":
        h.update(has_ev=False, ev_annual_km=30000.0)
    elif kind == "storage_without_solar":
        h.update(has_solar=False, existing_solar_kwp=None, has_storage=True, existing_storage_kwh=float(rng.choice([5, 10])))
    elif kind == "negative_demand":
        h["annual_demand_kwh"] = -float(round(rng.uniform(100, 5000), -1))
    return h


def generate(train, n: int = 10_000, seed: int = SEED) -> list[dict]:
    """train: the engine's training rows. Homes carry `_id`, `_split`, `_kind`."""
    rng = np.random.default_rng(seed)
    real = [_clean(row_inputs(r)) for r in train.to_dict("records")]
    n_in, n_edge = round(n * SPLIT["in_distribution"]), round(n * SPLIT["edge"])
    out = []
    for i in range(n):
        h = real[int(rng.integers(len(real)))]
        if i < n_in:
            split, kind, h = "in_distribution", "perturbed", _perturb(h, rng)
        elif i < n_in + n_edge:
            kind = EDGE_KINDS[(i - n_in) % len(EDGE_KINDS)]
            split, h = "edge", _edge(_perturb(h, rng), kind, rng)
        else:
            kind = ADV_KINDS[(i - n_in - n_edge) % len(ADV_KINDS)]
            split, h = "adversarial", _adversarial(_perturb(h, rng), kind, rng)
        out.append({**h, "_id": i, "_split": split, "_kind": kind})
    return out


DEMAND_BANDS = [0, 2500, 3500, 4500.5, 6000, 9000, 1e9]


def cell(h: dict) -> tuple:
    """A point of the variation space: installer, load profile, EV, heating, existing PV, demand band."""
    d = h.get("annual_demand_kwh") or 0
    band = int(np.searchsorted(DEMAND_BANDS, d, side="right")) - 1
    return (h["installer_id"], h.get("load_profile"), bool(h.get("has_ev")), h.get("heating_type"), bool(h.get("has_solar")), band)
