import json
"""Chained sizing model: PV, then battery given PV, then heat pump, then wallbox. Statistics plus physics, no LLM."""
import math
from dataclasses import dataclass, field
from typing import ClassVar

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.model_selection import cross_val_predict, train_test_split

import logging
import os

from . import hourly, rules

log = logging.getLogger("engine")
from .data import HEATING_TYPES, INSTALLERS, LOAD_PROFILES, date_t
from .hourly.optimum import NPV_TIE_EUR, NPV_TIE_SHARE

SEED = 42
K = 15
MODEL_VERSION = "chain-hgb-knn-7-mono+hourly"
NO_PV_RULE = "pv"  # "pv": propose PV when a battery would otherwise have none; "battery_none": drop the battery
T_NOW = {"t": 2026.3}  # latest offer date in train; used when a request carries no offer_date
COMPONENTS = ["pv", "battery", "heatpump", "wallbox"]
UNITS = {"pv": "kWp", "battery": "kWh", "heatpump": "kW", "wallbox": "kW"}
TARGET = {"pv": "pv_kwp", "battery": "battery_kwh", "heatpump": "heatpump_kw", "wallbox": "wallbox_kw"}
NAMES = {"pv": "PV", "battery": "a battery", "heatpump": "a heat pump", "wallbox": "a wallbox"}


# Grey-box (lab iteration 3): base = physics optimum (20-year NPV over the installer's catalogue, no expert label, PV capped
# at the roof when known). mode "ratio": the size regressors learn expert / optimum; "residual": expert minus optimum;
# "feature": the optimum is a feature; "batfeat" (iteration 4): only the optimum battery for the stage PV, as a feature of the battery stage. Decisions keep the classifiers. base "argmax" best NPV, "cheap" cheapest in the tie band.
# grid: an Engine whose catalogue the optimum uses (lab/greybox.py sets the full-train one in CV so cached grids stay valid).
GREYBOX = {"mode": None, "base": "argmax", "grid": None}
_GRID = {}  # memo: (installer, inputs, catalogue) -> (pv sizes, battery sizes, NPV matrix)

RECOMMENDER = {"mode": os.environ.get("RECOMMENDER", "ml").strip().lower()}  # v2.0: "rules" | "ml"
PRIORS: dict = {}  # field -> mean swing from engine/.cache/leads/steps.jsonl; tie-breaker in ask()
MONO = True  # monotone in demand (PV) and price (battery); 4,500 kWh default imputed, missing price = 32 ct
DEMAND_IMPUTE: dict = {}  # load profile -> median non-default demand in train


def base_features(inp: dict, installer: str) -> dict:
    d = float(inp.get("annual_demand_kwh") or 0)
    if MONO and d in (0.0, 4500.0) and DEMAND_IMPUTE:  # the pack's default, not a measurement
        d = DEMAND_IMPUTE.get(inp.get("load_profile"), DEMAND_IMPUTE["_all"])
    f = {
        "inst": INSTALLERS.index(installer),
        "demand": d,
        "log_demand": math.log1p(d),
        "has_ev": float(bool(inp.get("has_ev"))),
        "ev_km": inp.get("ev_annual_km") if inp.get("has_ev") and inp.get("ev_annual_km") is not None else np.nan,  # stale mileage never counts
        "has_wallbox": float(bool(inp.get("has_wallbox"))),
        "has_solar": float(bool(inp.get("has_solar"))),
        "solar_kwp": inp.get("existing_solar_kwp") if inp.get("has_solar") and inp.get("existing_solar_kwp") is not None else np.nan,
        "has_storage": float(bool(inp.get("has_storage"))),
        "storage_kwh": inp.get("existing_storage_kwh") if inp.get("has_storage") and inp.get("existing_storage_kwh") is not None else np.nan,
        "heat_cost": inp.get("heating_cost_per_year_eur") if inp.get("heating_cost_per_year_eur") is not None else np.nan,
        "heat_demand": inp.get("heating_demand_kwh") if inp.get("heating_demand_kwh") is not None else np.nan,
        "price": inp.get("electricity_price_ct_kwh") if inp.get("electricity_price_ct_kwh") is not None else (32.0 if MONO else np.nan),
        "inhabitants": inp.get("num_inhabitants") if inp.get("num_inhabitants") is not None else np.nan,
        "sqm": inp.get("house_size_sqm") if inp.get("house_size_sqm") is not None else np.nan,
        "t": date_t(inp["offer_date"]) if inp.get("offer_date") else T_NOW["t"],
        "demand_default": 0.0 if MONO else float(d in (0.0, 4500.0)),
    }
    for lp in LOAD_PROFILES:
        f[f"lp_{lp}"] = float(inp.get("load_profile") == lp)
    for h in HEATING_TYPES:
        f[f"heat_{h}"] = float(inp.get("heating_type", "Unknown") == h)
    return {k: (-1.0 if isinstance(v, float) and np.isnan(v) else v) for k, v in f.items()}


KNN_COLS = ["log_demand", "has_ev", "heat_Heatpump", "heat_known_fossil", "has_solar", "has_storage", "lp_not_h0"]
KNN_W = np.array([3.0, 1.5, 1.0, 1.0, 1.5, 1.0, 0.7])


def knn_vec(f: dict) -> np.ndarray:
    return np.array([f["log_demand"], f["has_ev"], f["heat_Heatpump"], f["heat_Gas"] + f["heat_Oil"],
                     f["has_solar"], f["has_storage"], 1.0 - f["lp_H0"]])


def snap_up(x: float, cat: np.ndarray) -> float:
    """Smallest catalogue size at or above x; largest if none."""
    up = cat[cat >= x - 1e-9]
    return float(up.min()) if len(up) else float(cat.max())


def snap(x: float, cat: np.ndarray) -> float:
    if x is None or len(cat) == 0:
        return x
    return float(cat[np.argmin(np.abs(cat - x))])


def fmt(x, unit):
    if x is None:
        return "None"
    s = f"{x:,.1f}".rstrip("0").rstrip(".")
    return f"{s} {unit}"


SIZES = ("pv_kwp", "inverter_kw", "battery_kwh", "heatpump_kw", "wallbox_kw")


def proposal_hash(design: dict, variant: str, investment: float) -> str:
    """sha256 over {"design": the five sizes, "variant": key, "investment_eur": capex}, keys sorted, compact JSON."""
    import hashlib
    body = json.dumps({"design": {k: design.get(k) for k in SIZES}, "variant": variant,
                       "investment_eur": round(float(investment or 0), 2)}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(body.encode()).hexdigest()


def add_hashes(out: dict, top_key: str = "expert") -> dict:
    """design_hash on the response and on every variant: what a planner sends back with PUT approve."""
    try:
        out["design_hash"] = proposal_hash(out["design"], top_key, (out.get("economics") or {}).get("capex_eur"))
        for v in out.get("variants") or []:
            v["design_hash"] = proposal_hash(v["design"], v["key"], (v.get("economics") or {}).get("capex_eur"))
    except Exception:
        pass
    return out


COMPASS_DEG = {"north": 0, "north-east": 45, "east": 90, "south-east": 135, "south": 180, "south-west": 225, "west": 270,
               "north-west": 315}


def stated_direction_check(inp: dict, out: dict):
    """A stated roof direction against the measured LoD2 faces: the measured design stands; a conflict is flagged
    (out["roof"]) and said in the explanation. Without a building model the stated direction drives the yield as before."""
    az = inp.get("roof_azimuth_deg")
    if az is None:
        az = COMPASS_DEG.get(str(inp.get("roof_orientation") or "").strip().lower())
    if az is None or not inp.get("address") or not out["design"].get("pv_kwp"):
        return
    from . import layout as L
    lo = L.layout(inp, out["design"]["pv_kwp"])
    if not lo:
        return
    faces = sorted({round(float(p["azimuth"])) % 360 for p in lo["planes"].get("planes", [])
                    if p.get("is_target") and p.get("azimuth") is not None})
    if not faces:
        return
    off = min(min(abs(f - az) % 360, 360 - abs(f - az) % 360) for f in faces)
    conflict = off > 45
    name = next((k for k, v in COMPASS_DEG.items() if min(abs(v - az) % 360, 360 - abs(v - az) % 360) <= 22.5), f"{az:g} degree")
    out["roof"] = {"stated_azimuth_deg": float(az), "measured_azimuths_deg": faces, "stated_direction_conflict": conflict,
                   "source": "LoD2 building model"}
    if conflict:
        note = f"Roof measured from the building model; your stated {name} face was not found."
        out["roof"]["note"] = note
        out["explanation"] = [note] + list(out.get("explanation") or [])


MIN_PV_FOR_BATTERY = 2.0  # kWp; below it a planner would not sign a battery (engine guard over the rules)

R5_DESIGN = {"pv": ("pv_kwp", "kWp"), "battery": ("battery_kwh", "kWh"), "bat_kwp": ("battery_kwh", "kWh"),
             "bat_day": ("battery_kwh", "kWh"), "inv": ("inverter_kw", "kW"), "hp": ("heatpump_kw", "kW"), "wb": ("wallbox_kw", "kW"),
             "cap": ("pv_kwp", "kWp")}


R5_COMP = {"pv": "pv", "battery": "battery", "inv": "inverter", "hp": "heatpump", "wb": "wallbox"}


def rules5_rows(R5, eng, inp, out):
    """Rules block while production is rules-4: per row Reonic's textbook line with its source, the rules-4 rule that
    produced this number, the planners' overall figure (PV), and the design value. rules-5's per-group constants are
    kept out of the block (they go to rules_applied_rules5 for the Check page)."""
    table = R5.rules_table(inp["installer_id"])
    design, comps = out.get("design") or {}, out.get("components") or {}
    rows = []
    for r in table:
        name = r.get("name")
        row = {"name": name, "textbook": r.get("textbook")}
        tb = r.get("textbook") or {}
        row["sentence"] = f"Reonic textbook: {tb.get('source')}." if tb.get("source") else r.get("sentence")
        c = comps.get(R5_COMP.get(name, ""), {}) if isinstance(comps, dict) else {}
        if c.get("reason"):
            row["rule"] = {"engine": "rules-4", "text": c["reason"]}
        if name == "pv":
            row["planners"] = eng.rule_of_thumb_comparison(inp, design)
        if name == "inv" and design.get("inverter_kw") and design.get("pv_kwp"):
            row["rule"] = {"engine": "rules-4", "text": f"{design['inverter_kw']:g} kW: the stocked size for {design['pv_kwp']:g} kWp, "
                                                        f"DC/AC {design['pv_kwp'] / design['inverter_kw']:.2f}."}
        key, unit = R5_DESIGN.get(name, (None, None))
        if key:
            row["design"] = {"value": design.get(key) or 0, "unit": unit}
        rows.append(row)
    return rows, table


@dataclass
class Engine:
    df: pd.DataFrame
    stats: dict
    train: pd.DataFrame = None
    test: pd.DataFrame = None
    models: dict = field(default_factory=dict)
    catalogue: dict = field(default_factory=dict)
    knn: dict = field(default_factory=dict)
    excluded: dict = field(default_factory=dict)

    # ---------- training ----------
    def fit(self):
        df = self.df.copy()
        out = (df.pv_kwp > 40) | (df.battery_kwh > 40) | (df.annual_demand_kwh < 500) | (df.annual_demand_kwh > 30000)
        self.excluded = {"outliers": int(out.sum()), "rule": "PV over 40 kWp, battery over 40 kWh, or demand outside 500 to 30,000 kWh"}
        df = df[~out].reset_index(drop=True)
        tr, te = train_test_split(df, test_size=0.2, random_state=SEED, stratify=df.installer_id)
        return self.fit_on(tr, te)

    def fit_on(self, tr: pd.DataFrame, te: pd.DataFrame):
        """Fit on a given train frame; te is only stored (scored by evaluate). lab/cv.py calls this per fold."""
        self.train, self.test = tr.reset_index(drop=True), te.reset_index(drop=True)
        tr = self.train
        T_NOW["t"] = max(date_t(x) for x in tr.offer_date)
        real = tr[~tr.annual_demand_kwh.isin([0.0, 4500.0])]
        DEMAND_IMPUTE.clear()
        DEMAND_IMPUTE.update({lp: float(g.annual_demand_kwh.median()) for lp, g in real.groupby("load_profile") if len(g) >= 10})
        DEMAND_IMPUTE["_all"] = float(real.annual_demand_kwh.median())
        self.demand_impute = dict(DEMAND_IMPUTE)
        self.t_now = T_NOW["t"]
        X = pd.DataFrame([base_features(r, r["installer_id"]) for r in tr.to_dict("records")])
        # offer date picks the battery catalogue only; as a model feature it lowered the scoreboard (README)
        X = X.drop(columns=["t"])

        for inst in INSTALLERS:
            t = tr[tr.installer_id == inst]
            vc_pv = t[t.pv_kwp > 0].pv_kwp.round(2).value_counts()
            vc_b = t[t.battery_kwh > 0].battery_kwh.value_counts()
            vc_hp = t[t.heatpump_kw > 0].heatpump_kw.value_counts()
            vc_wb = t[t.wallbox_kw > 0].wallbox_kw.value_counts()
            cat = self.catalogue[inst] = {
                "pv": np.sort(vc_pv[vc_pv >= 2].index.values.astype(float)),
                "battery": np.sort(vc_b[vc_b >= 3].index.values.astype(float)),
                "heatpump": np.sort(vc_hp.index.values.astype(float)) if len(vc_hp) else np.array([5.5, 7.5, 10.5, 12.5]),
                "wallbox": np.sort(vc_wb.index.values.astype(float)),
                "battery_share": float((t.battery_kwh > 0).mean()),
                "battery_median": float(t[t.battery_kwh > 0].battery_kwh.median()),
                "wallbox_mode": float(vc_wb.idxmax()) if len(vc_wb) else 11.0,
            }
            V = np.array([knn_vec(base_features(r, inst)) for r in t.to_dict("records")])
            mu, sd = V.mean(0), V.std(0) + 1e-6
            tb = t[t.battery_kwh > 0]
            cat["bat_t"] = np.array([date_t(x) for x in tb.offer_date])
            cat["bat_s"] = tb.battery_kwh.values.astype(float)
            self.knn[inst] = {"V": (V - mu) / sd * KNN_W, "mu": mu, "sd": sd, "rows": t.reset_index(drop=True)}

        gb = GREYBOX["mode"]
        if gb:
            rows_ = tr.to_dict("records")
            grids = [self.opt_grid(row_inputs(r), r["installer_id"], date_t(r["offer_date"])) for r in rows_]
            opt_pv = np.array([opt_base(g)[0] for g in grids])
            if gb == "feature":
                X = X.assign(opt_pv=opt_pv, opt_bat=[opt_base(g)[1] for g in grids])
        self.cols = list(X.columns)
        y = {c: tr[TARGET[c]].values for c in COMPONENTS}
        mono_pv = {"demand": 1, "log_demand": 1} if MONO else None
        mono_bat = {"price": 1} if MONO else None
        clf = lambda m=None: HistGradientBoostingClassifier(max_iter=200, learning_rate=0.05, max_depth=4, min_samples_leaf=15, random_state=SEED, monotonic_cst=m)
        reg = lambda m=None: HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_depth=4, min_samples_leaf=15, loss="absolute_error", random_state=SEED, monotonic_cst=m)

        # PV (grey-box: the regressor learns the expert's deviation from the optimum; gb_fwd/gb_inv in this module)
        b_pv = np.array([gb_floor(v, self.grid_cat(i)["pv"]) for v, i in zip(opt_pv, tr.installer_id)]) if gb in ("ratio", "residual") else None
        self.models["pv_dec"] = clf(mono_pv).fit(X, y["pv"] > 0)
        m = y["pv"] > 0
        self.models["pv_size"] = reg(mono_pv).fit(X[m], gb_fwd(y["pv"], b_pv)[m])
        pv_oof = np.where(cross_val_predict(clf(mono_pv), X, y["pv"] > 0, cv=5), gb_inv(cross_val_predict(reg(mono_pv), X, gb_fwd(y["pv"], b_pv), cv=5), b_pv), 0.0)
        X1 = X.assign(pv=pv_oof)
        # battery given PV (base: the optimum battery for the chained PV)
        b_bat = None
        if gb:
            ob = np.array([opt_base(g, p)[1] for g, p in zip(grids, pv_oof)])
            if gb in ("feature", "batfeat"):
                X1 = X1.assign(opt_bat_pv=ob)
            else:
                b_bat = np.array([gb_floor(v, self.grid_cat(i)["battery"]) for v, i in zip(ob, tr.installer_id)])
        self.models["bat_dec"] = clf(mono_bat).fit(X1, y["battery"] > 0)
        m = y["battery"] > 0
        self.models["bat_size"] = reg(mono_bat).fit(X1[m], gb_fwd(y["battery"], b_bat)[m])
        bat_oof = np.where(cross_val_predict(clf(mono_bat), X1, y["battery"] > 0, cv=5), gb_inv(cross_val_predict(reg(mono_bat), X1, gb_fwd(y["battery"], b_bat), cv=5), b_bat), 0.0)
        X2 = (X1.drop(columns="opt_bat_pv") if gb == "batfeat" else X1).assign(battery=bat_oof)
        # heat pump: too few sold to learn a size; decision from data, size from physics
        self.hp_positive = int((y["heatpump"] > 0).sum())
        self.models["hp_dec"] = clf().fit(X2, y["heatpump"] > 0) if self.hp_positive >= 5 else None
        # wallbox
        self.models["wb_dec"] = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.05, max_depth=3, min_samples_leaf=20, random_state=SEED).fit(X2, y["wallbox"] > 0)
        m = y["wallbox"] > 0
        self.models["wb_size"] = clf().fit(X2[m], y["wallbox"][m] > 11)
        return self

    def restore_globals(self):
        """Module-level state set in fit(); a pickled engine must put it back before predicting."""
        if getattr(self, "t_now", None):
            T_NOW["t"] = self.t_now
        DEMAND_IMPUTE.clear()
        DEMAND_IMPUTE.update(getattr(self, "demand_impute", {}))
        return self

        # ---------- neighbours ----------
    def neighbours(self, inp: dict, inst: str) -> pd.DataFrame:
        k = self.knn[inst]
        v = (knn_vec(base_features(inp, inst)) - k["mu"]) / k["sd"] * KNN_W
        d = np.sqrt(((k["V"] - v) ** 2).sum(1))
        idx = np.argsort(d)[:K]
        return k["rows"].iloc[idx]

    @staticmethod
    def nb_stats(nb: pd.DataFrame, comp: str) -> dict:
        s = nb[TARGET[comp]].values
        inc = s[s > 0]
        q = (lambda p: round(float(np.percentile(inc, p)), 2)) if len(inc) else (lambda p: None)
        return {"n": int(len(s)), "share_included": round(float((s > 0).mean()), 3),
                "median_size": q(50), "p25": q(25), "p75": q(75)}

    # ---------- prediction ----------
    def predict(self, inp: dict, overrides: dict | None = None, full: bool = True, extras: bool = True, snap: bool = True) -> dict:
        """The live recommender: the transparent rules (v2.0) when RECOMMENDER=rules, else the learned chain.
        snap: sizes go to the SKU catalogue's ladder (v2.15); the exam paths pass False."""
        mode = RECOMMENDER["mode"]
        if mode in ("rules", "calibrated", "band", "readout", "rules5"):
            out = self.predict_rules(inp, overrides, full, extras, engine=mode, snap=snap)
        else:
            out = self.predict_ml(inp, overrides, full, extras)
        out = with_heat_bound(inp, out)
        try:
            dv = out["components"]["pv"].get("derivation")
            if isinstance(dv, dict):
                dv["rule_of_thumb_comparison"] = self.rule_of_thumb_comparison(inp, out["design"])
        except Exception:
            pass
        try:  # the same id /api/explain/layers reports, so a stored draft and the layers can be compared
            from . import layout as L
            lo = L.layout(inp, out["design"].get("pv_kwp")) if inp.get("address") else None
            out["same_run_id"] = L.run_id(inp, out["design"], lo["pv_planes"] if lo else None)
        except Exception:
            pass
        try:
            stated_direction_check(inp, out)
        except Exception:
            pass
        try:  # v2.14: each variant's modules per face (the slot grid's first n per face are placed), so one call carries every layout
            if inp.get("address") and out.get("variants"):
                from . import shading as _sh
                for v in out["variants"]:
                    if snap:
                        from . import catalogue as _C
                        v["skus"] = _C.snap(v.get("design") or {}, overrides)[1]
                    kwp = (v.get("design") or {}).get("pv_kwp")
                    counts = _sh.chosen_counts(inp["address"], kwp) if kwp else {}
                    v["layout"] = {"modules_per_face": counts, "modules": sum(counts.values())}
        except Exception:
            log.exception("variant layouts")
        try:  # v2.14: the rate card behind the investment total (v2.15: each line names its SKU)
            from .hourly import sim as _sim
            out["rates"] = _sim.rates(inp, out["design"])
            names = {"pv": "module", "battery": "battery", "wallbox": "wallbox", "heatpump": "heatpump"}
            for ln in out["rates"].get("lines", []):
                sk = (out.get("skus") or {}).get(names.get(ln["item"], ""))
                if sk:
                    ln["sku"] = sk["name"] + (f" x {sk['modules']}" if sk.get("modules") else "")
        except Exception:
            log.exception("rates")
        add_hashes(out, "edit" if overrides else "expert")
        return out

    def rules_catalogue(self, inst: str, t: float) -> dict:
        cat = self.catalogue[inst]
        return {"pv_kwp": [float(x) for x in cat["pv"]], "battery_kwh": [float(x) for x in self.battery_catalogue(inst, t)],
                "heatpump_kw": [float(x) for x in cat["heatpump"]], "inverter_kw": [float(x) for x in rules.INVERTER_SIZES],
                "wallbox_kw": self.wallbox_default(inst)}

    def predict_rules(self, inp: dict, overrides: dict | None = None, full: bool = True, extras: bool = True,
                      engine: str = "rules", snap: bool = True) -> dict:
        """v2.0: design from app/planner_rules (REONIC PHYSICS), wrapped with the same evidence, physics and variants."""
        from . import planner_rules
        inst = inp["installer_id"]
        if inst not in self.catalogue:
            raise ValueError(f"Unknown installer_id {inst}")
        ov = overrides or {}
        t = base_features(inp, inst)["t"]
        rec_in = self.rules_inputs(inp)
        fn = {"calibrated": planner_rules.calibrated.recommend, "band": planner_rules.rules3.recommend,
              "readout": planner_rules.rules4.recommend}.get(engine, planner_rules.recommend)
        if engine == "rules5":
            from .planner_rules import rules5 as R5
            fn = R5.recommend
        r = rules_cached(fn, rec_in, self.rules_catalogue(inst, t), {k: v for k, v in ov.items() if k in SIZES})
        design = {k: (r["design"].get(k) or None) for k in ("pv_kwp", "inverter_kw", "battery_kwh", "heatpump_kw", "wallbox_kw")}
        nb = self.neighbours(inp, inst)
        comps = {}
        for c in COMPONENTS:
            rc = r["components"][c]
            size = design[TARGET[c]] or 0.0
            src = "planner" if TARGET[c] in ov and ov[TARGET[c]] != "include" else ("include" if ov.get(TARGET[c]) == "include" else "model")
            d = self._detail(c, size, 1.0 if size else 0.0, nb, inp, src)
            d["reason"] = rc.get("reason") or d["reason"]
            if rc.get("derivation"):
                d["derivation"] = rc["derivation"]
            comps[c] = d
        if design.get("pv_kwp") and inp.get("address") and "pv_kwp" not in ov:  # one pipeline: never more PV than the layout places
            from . import layout as L
            lo = L.layout(inp, design["pv_kwp"])
            if lo and lo["modules"] < L.modules_for(design["pv_kwp"]):
                want, got = design["pv_kwp"], round(lo["modules"] * L.MODULE_KWP, 2)
                design["pv_kwp"] = got
                design["inverter_kw"] = rules.inverter_kw(got)
                comps["pv"].update(size=got, reason=f"{got:g} kWp: the roof layout places {lo['modules']} modules on this house's "
                                                    f"planes (the rule asked {want:g} kWp, {L.modules_for(want)} modules). "
                                                    + (comps["pv"].get("reason") or ""))
        if (design.get("battery_kwh") and (design.get("pv_kwp") or 0) < MIN_PV_FOR_BATTERY and "battery_kwh" not in ov):
            was = design["battery_kwh"]
            design["battery_kwh"] = None
            comps["battery"].update(decision="none", size=None, confidence=1.0,
                                    reason=f"No battery: {design.get('pv_kwp') or 0:g} kWp is under {MIN_PV_FOR_BATTERY:g} kWp, too little "
                                           f"PV to fill one (the rule gave {was:g} kWh; only 6 of 1,256 signed designs are under "
                                           f"{MIN_PV_FOR_BATTERY:g} kWp). The planner can still add one.")
        skus = {}
        if snap:  # v2.15: every size a real product from the catalogue; economics, layout and variants run on these sizes
            from . import catalogue
            before = dict(design)
            design, skus = catalogue.snap(design, ov)
            for c in COMPONENTS:
                k = TARGET[c]
                if design.get(k) != before.get(k) and design.get(k):
                    comps[c]["size"] = design[k]
                    comps[c]["reason"] = (comps[c].get("reason") or "") + f" Catalogue size: {design[k]:g} {'kWp' if k == 'pv_kwp' else catalogue.UNIT[catalogue.PART[k]]}" + \
                        (f" ({skus['module']['modules']} x {catalogue.MODULE_W} W modules)." if k == "pv_kwp" and skus.get("module") else ".")
            for c, part in (("pv", "module"), ("battery", "battery"), ("wallbox", "wallbox"), ("heatpump", "heatpump")):
                if skus.get(part):
                    comps[c]["sku"] = skus[part]
            if skus.get("inverter"):
                comps["pv"]["inverter_sku"] = skus["inverter"]
        phys_inp = {**inp, **(r.get("sim_inputs") or {})}  # the planes and yields rules-2 swept, so economics match its pick
        if snap and design.get("pv_kwp") != r["design"].get("pv_kwp") and inp.get("address"):
            phys_inp.pop("pv_planes", None)  # the swept planes were for the unsnapped size: lay out the catalogue size again
        econ, plaus, opt = self._physics(phys_inp, design, inst, t, full, extras)
        out = {"design": design, "explanation": list(r.get("explanation") or [])[:6], "components": comps, "plausibility": plaus,
               "economics": econ, **({"skus": skus} if skus else {}),
               "model_version": {"calibrated": "rules-1-calibrated"}.get(engine) or r.get("version") or planner_rules.RULES_VERSION,
               "rules": r.get("rules", [])}
        if engine == "readout":  # rules-5's wording (textbook, planners, design per rule) reads best: serve it when it exists
            try:
                from .planner_rules import rules5 as R5
                if hasattr(R5, "rules_table"):
                    out["rules_applied"] = out["rules"]
                    out["rules"], out["rules_applied_rules5"] = rules5_rows(R5, self, inp, out)
            except ImportError:
                pass
            except Exception as e:
                log.warning("rules-5 wording unavailable: %s", e)
        if engine == "calibrated":  # the Rules block reads as rules-4's rule list; the sizes and derivations stay rules-1's
            try:
                out["rules_applied"] = out["rules"]
                out["rules"] = planner_rules.rules4.rules_table(inst)
            except Exception as e:
                log.warning("rules-4 wording unavailable: %s", e)
        if engine in ("calibrated", "band", "readout", "rules5"):
            from . import layout as L
            out["objective"] = L.OBJECTIVE  # the variants' yardstick; the design itself is the rule list
        elif r.get("objective"):
            out["objective"] = r["objective"]
        if opt:
            out["optimum"] = opt
        if full and extras and design.get("pv_kwp"):
            try:
                out["variants"] = (self.variants_physics(inp, design, econ, rec_in, self.rules_catalogue(inst, t))
                                   if engine in ("calibrated", "band", "readout", "rules5") else self.variants(phys_inp, design, econ))
            except Exception as e:
                log.warning("variants failed: %s", e)
        return out

    VARIANT_FROM_FRONTIER = (("value", "knee", "Best value"), ("payback", "payback", "Best payback"),
                             ("independence", "independence", "Most independence"), ("upfront", "upfront", "Lowest upfront cost"))

    VARIANT_LABEL_V = {"value": "Best value", "payback": "Best payback", "independence": "Most independence",
                       "upfront": "Lowest upfront cost"}

    def variants_physics(self, inp, design, econ, rec_in, cat) -> list:
        """The design first, then the best 20-year value, best payback, most independence and lowest upfront cost among every
        PV size and package, each laid out on this roof and simulated on its own planes (one pipeline). Preference reorders."""
        from . import layout as L
        rows = L.value_frontier(self, inp, design)
        out = [{"key": "expert", "label": self.VARIANT_LABEL["expert"], "design": design, "economics": econ,
                "note": "The design planners at this installer fit to homes like this one."}]
        for key in ("value", "payback", "independence", "upfront"):
            r = next((x for x in rows if key in (x.get("labels") or [])), None)
            if r is None:
                continue
            same = r["chosen"]
            note = ({"value": "The planners' design is already the best 20-year value on this roof.",
                     "payback": "The planners' design already pays back soonest.",
                     "independence": "The planners' design already gives the most independence.",
                     "upfront": "The planners' design is already the cheapest with PV."}[key] if same
                    else variant_note(r["_design"], r["_econ"], design, econ))
            out.append({"key": key, "label": self.VARIANT_LABEL_V[key], "design": r["_design"], "economics": r["_econ"], "note": note})
        pref = inp.get("preference")
        if pref in ("independence", "payback", "upfront"):
            out.sort(key=lambda v: v["key"] != pref)
        return out

    def rules_inputs(self, inp: dict) -> dict:
        """What the rules read: the inputs, the roof as the simulation sees it, and the built house model when cached."""
        rec_in = roof_to_sim({k: v for k, v in inp.items() if k != "_estimated"})
        if "floor area" in (inp.get("_estimated") or []):  # an address estimate is not something the lead said
            rec_in.pop("house_size_sqm", None)
        if inp.get("address") and inp.get("roof"):
            m = __import__("app.roofs", fromlist=["model_json_cached"]).model_json_cached(inp["address"], inp.get("house_built_year"))
            if m:
                rec_in["roof_model"] = m
        return rec_in

    def predict_rules5(self, inp: dict) -> dict:
        from .planner_rules import rules5
        t = base_features(inp, inp["installer_id"])["t"]
        r = rules5.recommend(self.rules_inputs(inp), self.rules_catalogue(inp["installer_id"], t), None)
        return {k: (r["design"].get(k) or None) for k in ("pv_kwp", "inverter_kw", "battery_kwh", "heatpump_kw", "wallbox_kw")}

    def predict_band(self, inp: dict) -> dict:
        from .planner_rules import rules3
        t = base_features(inp, inp["installer_id"])["t"]
        r = rules3.recommend(self.rules_inputs(inp), self.rules_catalogue(inp["installer_id"], t), None)
        return {k: (r["design"].get(k) or None) for k in ("pv_kwp", "inverter_kw", "battery_kwh", "heatpump_kw", "wallbox_kw")}

    def predict_readout(self, inp: dict) -> dict:
        from .planner_rules import rules4
        t = base_features(inp, inp["installer_id"])["t"]
        r = rules4.recommend(self.rules_inputs(inp), self.rules_catalogue(inp["installer_id"], t), None)
        return {k: (r["design"].get(k) or None) for k in ("pv_kwp", "inverter_kw", "battery_kwh", "heatpump_kw", "wallbox_kw")}

    def predict_calibrated(self, inp: dict) -> dict:
        """rules-1 (fitted constants), the fast comparison column; also ranks /api/ask questions in rules mode."""
        from .planner_rules import calibrated
        t = base_features(inp, inp["installer_id"])["t"]
        r = calibrated.recommend(self.rules_inputs(inp), self.rules_catalogue(inp["installer_id"], t), None)
        return {k: (r["design"].get(k) or None) for k in ("pv_kwp", "inverter_kw", "battery_kwh", "heatpump_kw", "wallbox_kw")}

    def predict_ml(self, inp: dict, overrides: dict | None = None, full: bool = True, extras: bool = True) -> dict:
        """full=False skips the hourly simulation and optimum (used by the scoreboard, which only needs sizes)."""
        inst = inp["installer_id"]
        if inst not in self.catalogue:
            raise ValueError(f"Unknown installer_id {inst}")
        ov = overrides or {}
        cat = self.catalogue[inst]
        f = base_features(inp, inst)
        gb = GREYBOX["mode"]
        g = self.opt_grid(inp, inst, f["t"]) if gb else None
        if gb == "feature":
            f["opt_pv"], f["opt_bat"] = opt_base(g)
        X = pd.DataFrame([f])[self.cols]
        nb = self.neighbours(inp, inst)
        comps, design = {}, {}
        gc = self.grid_cat(inst) if gb else None
        b_pv = gb_floor(opt_base(g)[0], gc["pv"]) if gb in ("ratio", "residual") else None

        def bat_frame(pv):
            X1 = X.assign(pv=pv)
            return X1.assign(opt_bat_pv=opt_base(g, pv)[1]) if gb in ("feature", "batfeat") else X1

        def bat_fn(X1, pv):
            b = gb_floor(opt_base(g, pv)[1], gc["battery"]) if gb in ("ratio", "residual") else None
            return snap(float(gb_inv(self.models["bat_size"].predict(X1), b)[0]), self.battery_catalogue(inst, f["t"]))

        def choose(key, p, size_fn):
            """Planner number/null fixes it; "include" forces it in and the engine sizes it; else the model decides."""
            if key in ov and ov[key] != "include":
                return ov[key] or 0.0, "planner"
            if ov.get(key) == "include":
                return size_fn(), "include"
            return (size_fn() if p >= 0.5 else 0.0), "model"

        # PV
        p_pv = float(self.models["pv_dec"].predict_proba(X)[0, 1])
        pv_fn = lambda: self.roof_cap(inp, snap(float(gb_inv(self.models["pv_size"].predict(X), b_pv)[0]), cat["pv"]), cat["pv"])
        pv, src = choose("pv_kwp", p_pv, pv_fn)
        comps["pv"] = self._detail("pv", pv, p_pv, nb, inp, src)
        # battery
        X1 = bat_frame(pv)
        p_b = float(self.models["bat_dec"].predict_proba(X1)[0, 1])
        bat, src = choose("battery_kwh", p_b, lambda: bat_fn(X1, pv))
        # a battery needs PV to charge: without PV, new or recorded, propose PV or drop the battery
        nopv_note = None
        if bat and not pv and not inp.get("has_solar") and src == "model":
            if NO_PV_RULE == "pv" and "pv_kwp" not in ov:
                pv = pv_fn()
                comps["pv"] = self._detail("pv", pv, p_pv, nb, inp, "model")
                comps["pv"]["reason"] = f"A battery needs PV to charge and none is recorded, so PV is proposed; {comps['pv']['reason']}"
                X1 = bat_frame(pv)
                bat = bat_fn(X1, pv)
            else:
                bat, nopv_note = 0.0, "No PV, new or recorded, so no battery: it could not charge from solar."
        if pv and inp.get("roof") and inp["roof"].get("max_kwp"):
            r = inp["roof"]
            if self._capped.get(id(inp)):
                comps["pv"]["reason"] += f" Capped by the roof: {r['max_panels']} modules fit, {r['max_kwp']:g} kWp at most."
            else:
                comps["pv"]["reason"] += f" The roof fits {r['max_panels']} modules, up to {r['max_kwp']:g} kWp."
        self._capped.pop(id(inp), None)
        comps["battery"] = self._detail("battery", bat, p_b, nb, inp, src, pv=pv)
        if nopv_note:
            comps["battery"]["reason"] = nopv_note
        X2 = (X1.drop(columns="opt_bat_pv") if gb == "batfeat" else X1).assign(battery=bat)
        # heat pump: never proposed where one exists; a planner "include" there is a replacement job
        p_h = float(self.models["hp_dec"].predict_proba(X2)[0, 1]) if self.models.get("hp_dec") else 0.0
        if inp.get("heating_type") == "Heatpump" and "heatpump_kw" not in ov:
            p_h = 0.0
        hp, src = choose("heatpump_kw", p_h, lambda: snap_up(rules.heatpump_kw(inp), cat["heatpump"]))
        if hp and inp.get("heating_type") == "Heatpump":
            inp = {**inp, "_hp_replacement": True}
        comps["heatpump"] = self._detail("heatpump", hp, p_h, nb, inp, src)
        # wallbox: decision from the EV flag (learned decision lost to this rule on test; README)
        p_w = float(self.models["wb_dec"].predict_proba(X2)[0, 1])
        wb, src = choose("wallbox_kw", 1.0 if inp.get("has_ev") else 0.0,
                         lambda: self.wallbox_default(inst))
        comps["wallbox"] = self._detail("wallbox", wb, p_w, nb, inp, src)

        inv = ov["inverter_kw"] if isinstance(ov.get("inverter_kw"), (int, float)) else rules.inverter_kw(pv)
        design = {"pv_kwp": pv or None, "inverter_kw": inv if pv else None, "battery_kwh": bat or None,
                  "heatpump_kw": hp or None, "wallbox_kw": wb or None}
        econ, plaus, opt = self._physics(inp, design, inst, f["t"], full, extras)
        if full:
            try:
                for c in COMPONENTS:
                    comps[c]["derivation"] = self._derivation(c, inp, design, comps[c], nb)
            except Exception as e:
                log.warning("derivation failed: %s", e)
        out = {"design": design, "explanation": self._explain(inp, design, comps, nb, econ),
               "components": comps, "plausibility": plaus, "economics": econ, "model_version": MODEL_VERSION}
        if opt:
            out["optimum"] = opt
        if full and extras and design.get("pv_kwp"):
            try:
                out["variants"] = self.variants(inp, design, econ)
            except Exception as e:
                log.warning("variants failed: %s", e)
        return out

    def sizes_batch(self, inps: list[dict]) -> list[dict]:
        """Sizes only, no overrides, for many homes in one pass per model; same logic as predict()."""
        if not inps:
            return []
        if GREYBOX["mode"]:  # lab only: the grey-box path goes through predict()
            return [self.predict(i, full=False)["design"] for i in inps]
        if RECOMMENDER["mode"] in ("rules", "calibrated", "band", "readout", "rules5"):  # questions ranked on the calibrated rules
            return [self.predict_calibrated(i) for i in inps]
        F = [base_features(i, i["installer_id"]) for i in inps]
        X = pd.DataFrame(F)[self.cols]
        n = len(inps)
        insts = [i["installer_id"] for i in inps]
        p_pv = self.models["pv_dec"].predict_proba(X)[:, 1]
        pv_raw = self.models["pv_size"].predict(X)
        pv_alt = np.array([self.roof_cap(inps[k], snap(float(pv_raw[k]), self.catalogue[insts[k]]["pv"]), self.catalogue[insts[k]]["pv"]) for k in range(n)])
        for i in inps:
            self._capped.pop(id(i), None)
        pv = np.where(p_pv >= 0.5, pv_alt, 0.0)
        X1 = X.assign(pv=pv)
        p_b = self.models["bat_dec"].predict_proba(X1)[:, 1]
        b_raw = self.models["bat_size"].predict(pd.concat([X1, X.assign(pv=pv_alt)], ignore_index=True))
        out = []
        X2 = X1.copy()
        bats = np.zeros(n)
        for k in range(n):
            cat_b = self.battery_catalogue(insts[k], F[k]["t"])
            b = snap(float(b_raw[k]), cat_b) if p_b[k] >= 0.5 else 0.0
            if b and not pv[k] and not inps[k].get("has_solar"):
                if NO_PV_RULE == "pv":
                    pv[k] = pv_alt[k]
                    b = snap(float(b_raw[n + k]), cat_b)
                else:
                    b = 0.0
            bats[k] = b
        X2 = X.assign(pv=pv, battery=bats)
        p_h = self.models["hp_dec"].predict_proba(X2)[:, 1] if self.models.get("hp_dec") else np.zeros(n)
        p_22 = self.models["wb_size"].predict_proba(X2)[:, 1]
        for k, i in enumerate(inps):
            cat = self.catalogue[insts[k]]
            hp = snap_up(rules.heatpump_kw(i), cat["heatpump"]) if p_h[k] >= 0.5 and i.get("heating_type") != "Heatpump" else 0.0
            wb = self.wallbox_default(insts[k]) if i.get("has_ev") else 0.0
            out.append({"pv_kwp": float(pv[k]) or None, "inverter_kw": rules.inverter_kw(pv[k]) if pv[k] else None,
                        "battery_kwh": float(bats[k]) or None, "heatpump_kw": hp or None, "wallbox_kw": wb or None})
        return out

    def grid_cat(self, inst):
        src = GREYBOX["grid"] or self
        return src.catalogue[inst]

    def opt_grid(self, inp: dict, inst: str, t: float):
        """20-year NPV of every catalogue PV and battery size (none included) for this home, hourly simulation; PV no
        larger than a known roof holds. No heat pump, no wallbox, no expert label: the base of the grey-box model."""
        src = GREYBOX["grid"] or self
        pvs = np.concatenate([[0.0], src.catalogue[inst]["pv"]])
        bats = np.concatenate([[0.0], src.battery_catalogue(inst, t)])
        roof = inp.get("roof") or {}
        if roof.get("max_kwp"):
            pvs = pvs[pvs <= roof["max_kwp"] + 1e-9]
        clean = {k: v for k, v in inp.items() if not k.startswith("_") and k not in ("offer_date", "installer_id", "roof")}
        key = (inst, tuple(sorted(clean.items(), key=lambda kv: kv[0])), tuple(pvs), tuple(bats))
        if roof:
            key = key + (repr(sorted(roof.items(), key=lambda kv: kv[0])),)
        if key in _GRID:
            return _GRID[key]
        sim_in = roof_to_sim({**clean, "roof": roof}) if roof else clean
        sim_in = {k: v for k, v in sim_in.items() if k != "roof"} if not roof else sim_in
        npv = np.full((len(pvs), len(bats)), np.nan)
        for i, pv in enumerate(pvs):
            for j, b in enumerate(bats):
                if not pv and not b:
                    npv[i, j] = 0.0
                    continue
                if b and not pv and not clean.get("has_solar"):
                    continue
                d = {"pv_kwp": pv or None, "inverter_kw": rules.inverter_kw(pv) if pv else None, "battery_kwh": b or None}
                npv[i, j] = hourly.simulate(sim_in, d).economics["annual"]["npv_20y_eur"] or 0.0
        _GRID[key] = (pvs, bats, npv)
        return _GRID[key]

    _capped: ClassVar[dict] = {}  # inputs whose PV the roof capped, for the reason line

    def roof_cap(self, inp, pv, cat) -> float:
        """PV no larger than the roof holds (usable m2 / 5.5): the largest catalogue size that fits."""
        r = inp.get("roof") or {}
        m = r.get("max_kwp")
        if not m or pv <= m:
            return pv
        fits = cat[cat <= m + 1e-9]
        self._capped[id(inp)] = True
        return float(fits.max()) if len(fits) else round(int(m / 0.463) * 0.463, 2)

    def wallbox_default(self, inst) -> float:
        """The installer's wallbox size if it sells one size at least 60% of the time, else 11 kW (registration only;
        22 kW needs grid operator approval, docs/domain.md 1). The learned 11-vs-22 choice flipped on mileage alone: noise."""
        s = self.train[(self.train.installer_id == inst) & (self.train.wallbox_kw > 0)].wallbox_kw
        if len(s):
            vc = s.value_counts(normalize=True)
            if vc.iloc[0] >= 0.6:
                return float(vc.index[0])
        return 11.0

    ASK_TOL = {"pv_kwp": 1.0, "battery_kwh": 2.0, "heatpump_kw": 2.0, "wallbox_kw": 2.0}

    def ask(self, inp: dict, unknown: list | None = None) -> list:
        """Value of information: which missing or default input would move the design most.
        unknown: fields the lead did not state; when given, only those are asked (a stated "no EV" is never asked)."""
        cands = []
        ask_ = (lambda f, default: f in unknown) if unknown is not None else (lambda f, default: default)
        if ask_("heating_type", inp.get("heating_type", "Unknown") == "Unknown"):
            cands.append(("heating_type", inp.get("heating_type", "Unknown"),
                          [("Gas", "Gas", {"heating_type": "Gas"}), ("Heatpump", "Heat pump", {"heating_type": "Heatpump"})]))
        if ask_("has_ev", not inp.get("has_ev")):
            cands.append(("has_ev", inp.get("has_ev", False), [(True, "Yes, about 12,000 km a year", {"has_ev": True, "ev_annual_km": 12000}),
                                                               (False, "No", {"has_ev": False, "ev_annual_km": None})]))
        if ask_("annual_demand_kwh", not inp.get("annual_demand_kwh") or inp.get("annual_demand_kwh") == 4500):
            cands.append(("annual_demand_kwh", inp.get("annual_demand_kwh"),
                          [(3000, "about 3,000 kWh (two people)", {"annual_demand_kwh": 3000}),
                           (5000, "about 5,000 kWh (family of four)", {"annual_demand_kwh": 5000}),
                           (6500, "about 6,500 kWh (large household or home office)", {"annual_demand_kwh": 6500})]))
        if ask_("heating_demand_kwh", inp.get("heating_type") in ("Gas", "Oil", "OtherNonRenewable") and not inp.get("heating_demand_kwh")):
            cands.append(("heating_demand_kwh", None,
                          [(12000, "12,000 kWh", {"heating_demand_kwh": 12000}), (20000, "20,000 kWh", {"heating_demand_kwh": 20000})]))
        if ask_("has_solar", not inp.get("has_solar")):
            cands.append(("has_solar", inp.get("has_solar", False), [(True, "Yes, about 6 kWp", {"has_solar": True, "existing_solar_kwp": 6.0}),
                                                                     (False, "No", {"has_solar": False, "existing_solar_kwp": None})]))
        variants = [inp] + [{**inp, **ch} for _, _, opts in cands for _, _, ch in opts]
        designs = self.sizes_batch(variants)
        base, rest = designs[0], designs[1:]
        qs, k = [], 0
        for field_, cur, opts in cands:
            options, spread = [], 0.0
            for val, label, _ in opts:
                d = rest[k]
                k += 1
                sp = 0.0
                for key, tol in self.ASK_TOL.items():
                    a, b = base[key] or 0.0, d[key] or 0.0
                    sp += abs(a - b) / tol + (1.0 if (a > 0) != (b > 0) else 0.0)
                spread = max(spread, sp)
                options.append({"value": val, "label": label, "design": d})
            if spread > 0:
                qs.append({"field": field_, "current": cur, "options": options, "spread": round(spread, 2)})
        given = inp.get("_given")
        no_use = (unknown is not None and "annual_demand_kwh" in unknown) or (given is not None and "annual_demand_kwh" not in given)
        # annual use is the prerequisite: when the lead gives none, it is asked first whatever the spread
        # priors from the intake log (v1.9) only break ties in spread
        return sorted(qs, key=lambda q: (not (no_use and q["field"] == "annual_demand_kwh"), -q["spread"], -PRIORS.get(q["field"], 0.0)))[:3]

    def inbox(self, limit: int = 20) -> list:
        """Held-out new-system jobs: homes neither the ML board nor the rules-4 fit ever saw (the ML test board intersected
        with the planner rules' sealed half). Order by kind and installer only, never by whether the draft matched."""
        if getattr(self, "_inbox", None) is None:
            from .planner_rules.split import test_ids
            sealed = test_ids()
            te = self.test
            te = te[te.project_id.astype(str).isin(sealed)]
            te = te[(te.pv_kwp > 0) | te.has_solar]
            # show real new-system homes with real inputs: no sub-2 kWp leftovers, no untouched 4,500 kWh defaults
            te = te[~((te.pv_kwp < 2) & ~te.has_solar) & ~((te.annual_demand_kwh == 4500) & (te.heating_type == "Unknown"))]
            te = te.sort_values("project_id").reset_index(drop=True)
            rows = te.to_dict("records")
            drafts = self.sizes_batch([row_inputs(r) for r in rows])
            items = []
            for r, d in zip(rows, drafts):
                w = {c: bool(rules.within(c, [d[TARGET[c]] or 0.0], [r[TARGET[c]]])[0]) for c in COMPONENTS}
                w["all"] = all(w.values())
                items.append((r, d, w))
            def kind(r):
                if r["heatpump_kw"] > 0 or r["heating_type"] != "Unknown":
                    return "heating"
                if r["has_ev"] or r["wallbox_kw"] > 0:
                    return "ev"
                return "battery" if r["battery_kwh"] > 0 else "pv_only"
            buckets = {}
            for x in items:
                buckets.setdefault((kind(x[0]), x[0]["installer_id"]), []).append(x)
            keys = sorted(buckets, key=lambda k: (["battery", "ev", "heating", "pv_only"].index(k[0]), k[1]))
            ordered = []
            while any(buckets[k] for k in keys):
                for k in keys:
                    if buckets[k]:
                        ordered.append(buckets[k].pop(0))
            self._inbox = ordered
        out = []
        for r, d, w in self._inbox[:limit]:
            inp = row_inputs(r)
            full = self.predict(inp, full=False, snap=False)  # the replay is scored like the exam: unsnapped
            d = full["design"]  # the flags judge the design shown on the row, not the order-time draft
            w = {c: bool(rules.within(c, [d[TARGET[c]] or 0.0], [r[TARGET[c]]])[0]) for c in COMPONENTS}
            w["all"] = all(w.values())
            inc = [c for c in full["components"].values() if c["decision"] == "include"]
            note = ""
            if not w["all"]:
                c = next(c for c in ("pv", "battery", "wallbox", "heatpump") if not w[c])
                note = self._inbox_note(c, r, d[TARGET[c]] or 0.0, float(r[TARGET[c]]))
            out.append({"project_id": r["project_id"], "installer_id": r["installer_id"], "inputs": inp,
                        "draft": full["design"], "confidence": self.agreement(inp, full["design"]),
                        "expert": row_design(r), "within": w, "note": note, "_row": r})
        return sorted(out, key=lambda x: x["confidence"])  # least sure first: the planner's review queue

    def agreement(self, inp, draft) -> float:
        """Share of the 15 most similar past homes whose design is within tolerance of the draft on all four components."""
        nb = self.neighbours(inp, inp["installer_id"])
        hit = np.ones(len(nb), bool)
        for c in COMPONENTS:
            k = TARGET[c]
            hit &= rules.within(c, np.full(len(nb), draft.get(k) or 0.0), nb[k].values)
        return round(float(hit.mean()), 2)

    def _derivation(self, comp, inp, design, detail, nb) -> dict:
        """Why this number (v1.5): one physical axiom with this home's numbers, then the learned adjustment that
        closes the gap to the engine's value. The axiom is never the whole story: the adjustment says what the data adds."""
        key = TARGET[comp]
        final = design.get(key)
        n = len(nb)
        given = inp.get("_given")
        src_of = (lambda k: "lead" if k in given else "default") if given is not None else \
                 (lambda k: "lead" if inp.get(k) not in (None, False, "Unknown") else "default")
        planner = detail["reason"].startswith(("Set by the planner", "Included by the planner"))
        s = nb[key].values
        sim_in = roof_to_sim({k: v for k, v in inp.items() if not k.startswith("_")})

        if comp == "pv":
            yld = float(hourly.sim.pv_profile(sim_in, "Munich").sum())
            d = float(inp.get("annual_demand_kwh") or 0)
            ev = rules.ev_kwh(inp)
            use = d + ev
            ax = round(use / yld, 2) if yld else None
            ins = [{"name": "household use", "value": d, "unit": "kWh a year", "source": src_of("annual_demand_kwh")},
                   {"name": "yield here", "value": round(yld), "unit": "kWh per kWp a year", "source": "pvgis"}]
            eq = f"{d:,.0f} kWh"
            if ev:
                ins.append({"name": "EV charging", "value": round(ev), "unit": "kWh a year", "source": src_of("ev_annual_km")})
                eq = f"({d:,.0f} + {ev:,.0f} EV) kWh"
            eq += f" / {yld:,.0f} kWh per kWp = {ax:g} kWp" if ax else ""
            axiom = "A year of sun on this roof should cover a year of use; planners then oversize."
            ratios = [x / (r_d / yld) for x, r_d in zip(s, nb.annual_demand_kwh.values) if x > 0 and r_d > 0] if yld else []
            peer = f"; similar homes' median x{np.median(ratios):.1f}" if ratios else ""
            if not final:
                return {"axiom": axiom, "equation": eq, "inputs": ins, "axiom_result": ax,
                        "adjustment": {"label": f"{(s == 0).sum()} of {n} similar homes got no new PV", "value": 0.0, "n_similar": n}, "final": None}
            if inp.get("roof") and inp["roof"].get("max_kwp"):
                ins.append({"name": "roof holds", "value": inp["roof"]["max_kwp"], "unit": "kWp", "source": inp["roof"].get("source", "lod2")})
            label = ("set by the planner" if planner else
                     f"planners like this one oversize: learned from {len(self.train[self.train.installer_id == inp['installer_id']])} past designs at this installer{peer}, snapped to a module count")
            return {"axiom": axiom, "equation": eq, "inputs": ins, "axiom_result": ax,
                    "adjustment": {"label": label, "value": round(final / ax, 2) if ax else 1.0, "n_similar": n}, "final": final}

        if comp == "battery":
            prof = hourly.sim.pv_profile(sim_in, "Munich")
            shape = hourly.sim.household_shape()
            night = float(shape[prof <= 1e-3].sum() / shape.sum())
            daily = float(inp.get("annual_demand_kwh") or 0) / 365
            ax = round(daily * night, 1)
            ins = [{"name": "household use", "value": round(daily, 1), "unit": "kWh a day", "source": src_of("annual_demand_kwh")},
                   {"name": "share used after sunset", "value": round(night, 2), "unit": "", "source": "pvgis"}]
            eq = f"{daily:.1f} kWh a day x {night:.0%} after sunset = {ax:g} kWh"
            axiom = "A battery should carry the evening and night from the day's sun."
            if not final:
                return {"axiom": axiom, "equation": eq, "inputs": ins, "axiom_result": ax,
                        "adjustment": {"label": detail["reason"], "value": 0.0, "n_similar": n}, "final": None}
            sold = self.battery_catalogue(inp["installer_id"], base_features(inp, inp["installer_id"])["t"])
            ins.append({"name": "installer packages", "value": ", ".join(f"{x:g}" for x in sold), "unit": "kWh", "source": "catalogue"})
            med = float(np.median(s[s > 0])) if (s > 0).any() else None
            label = ("set by the planner" if planner else
                     f"sized with the PV and snapped to the installer's package"
                     + (f"; {int((s > 0).sum())} of {n} similar homes got a battery, median {med:g} kWh" if med else ""))
            return {"axiom": axiom, "equation": eq, "inputs": ins, "axiom_result": ax,
                    "adjustment": {"label": label, "value": round(final / ax, 2) if ax else 1.0, "n_similar": n}, "final": final}

        if comp == "heatpump":
            kw, note = rules.heat_load_kw(inp)
            heat = inp.get("heating_demand_kwh") or (inp["heating_cost_per_year_eur"] / 0.12 if inp.get("heating_cost_per_year_eur") else None)
            axiom = "A heat pump runs about 2,300 full-load hours a year, so heat demand over 2,300 hours gives its size."
            env = inp.get("envelope") or {}
            if not inp.get("heating_demand_kwh") and not inp.get("heating_cost_per_year_eur") and env.get("design_heat_load_kw"):
                ax = round(float(env["design_heat_load_kw"]), 1)
                ins = [{"name": "design heat load", "value": ax, "unit": "kW", "source": "envelope (LoD2, IWU)"}]
                eq = f"design heat load {ax:g} kW from the walls, roof and windows of this house"
            elif heat:
                given = bool(inp.get("heating_demand_kwh"))
                ins = [{"name": "heat demand", "value": round(heat), "unit": "kWh a year", "source": "lead" if given else "default"},
                       {"name": "full-load hours", "value": 2300, "unit": "h", "source": "installer history"}]
                eq = f"{heat:,.0f} kWh / 2,300 h = {heat / 2300:.1f} kW"
                if not given:
                    ins.insert(0, {"name": "heating cost", "value": inp["heating_cost_per_year_eur"], "unit": "EUR a year", "source": "lead"})
                    ins.insert(1, {"name": "heat price", "value": 12, "unit": "ct per kWh of heat", "source": "default"})
                    eq = f"€{inp['heating_cost_per_year_eur']:,.0f} / 12 ct = {heat:,.0f} kWh; " + eq
                ax = round(heat / 2300, 1)
            else:
                ins = [{"name": "basis", "value": note, "unit": "", "source": "default"}]
                eq = f"{note}: {kw:.1f} kW"
                ax = round(kw, 1)
            if inp.get("heating_type") == "Heatpump" and not final:
                return {"axiom": axiom, "equation": eq, "inputs": ins, "axiom_result": None,
                        "adjustment": {"label": "the home already heats with a heat pump", "value": 0.0, "n_similar": n}, "final": None}
            if not final:
                return {"axiom": axiom, "equation": eq, "inputs": ins, "axiom_result": ax,
                        "adjustment": {"label": f"{int((s > 0).sum())} of {n} similar homes got a heat pump; this installer sold {self.hp_positive} in its history",
                                       "value": 0.0, "n_similar": n}, "final": None}
            sizes = self.catalogue[inp["installer_id"]]["heatpump"]
            ins.append({"name": "installer sizes", "value": ", ".join(f"{x:g}" for x in sizes), "unit": "kW", "source": "catalogue"})
            label = "set by the planner" if planner and detail["reason"].startswith("Set") else "rounded up to the next heat pump this installer sells"
            return {"axiom": axiom, "equation": eq, "inputs": ins, "axiom_result": ax,
                    "adjustment": {"label": label, "value": round(final / ax, 2) if ax else 1.0, "n_similar": n}, "final": final}

        # wallbox
        axiom = "A planned EV gets the installer's standard wallbox."
        ins = [{"name": "EV planned", "value": "yes" if inp.get("has_ev") else "no", "unit": "", "source": src_of("has_ev")},
               {"name": "installer standard", "value": self.wallbox_default(inp["installer_id"]), "unit": "kW", "source": "installer history"}]
        std = self.wallbox_default(inp["installer_id"])
        ax = std if inp.get("has_ev") else None
        eq = f"EV planned: {std:g} kW" if inp.get("has_ev") else "No EV planned: none"
        if final == ax or (not final and ax is None):
            adj = None
        else:
            adj = {"label": "set by the planner" if planner else detail["reason"], "value": (final or 0) / ax if ax else 0.0, "n_similar": n}
        return {"axiom": axiom, "equation": eq, "inputs": ins, "axiom_result": ax, "adjustment": adj, "final": final}

    def _physics(self, inp, design, inst, t, full, extras=True):
        from . import layout as L
        if design.get("pv_kwp") and inp.get("address"):  # the hourly year runs on the modules laid out on the real planes
            inp = L.sim_inputs({k: v for k, v in inp.items() if k != "pv_planes"}, design)
        """Hourly simulation (app/hourly) when it runs; the annual ratio model otherwise. Economics.method says which."""
        lookup = rules.economics(inp, design)
        lookup["method"] = "annual-lookup"
        if not full:
            return lookup, [], None
        clean = roof_to_sim({k: v for k, v in inp.items() if not k.startswith("_")})
        try:
            sim = hourly.simulate(clean, design)
            econ = sim.economics
            from . import cashflow
            cashflow.add(clean, design, econ)
            phys = hourly.validate_physics(clean, design, sim=sim)
            rep, why = hourly.replay_2025(clean, design)  # additive: the typical-year economics above stay as they are
            if rep:
                econ["replay_2025"] = rep
            else:
                econ["assumptions"].append(f"2025 replay unavailable ({why}).")
        except Exception as e:  # keep serving with the ratio model; say why
            log.warning("hourly simulation failed, using annual lookup: %s", e)
            lookup["assumptions"].append(f"Hourly simulation unavailable ({e}); annual ratio model used.")
            return lookup, rules.plausibility(inp, design, lookup), None
        plaus = [p for p in rules.plausibility(inp, design, econ) if not p["message"].startswith("DC/AC")] + phys
        opt = None
        try:
            pvs = self.catalogue[inst]["pv"]
            pv0 = design["pv_kwp"] or 0
            near = pvs[(pvs >= 0.5 * pv0) & (pvs <= 1.6 * pv0)]
            near = near[np.unique(np.linspace(0, len(near) - 1, min(8, len(near))).round().astype(int))] if len(near) else pvs
            cat = {"pv_kwp": sorted({float(x) for x in near} | {float(pv0)}),
                   "battery_kwh": [float(x) for x in self.battery_catalogue(inst, t)]}
            opt = hourly.optimum(clean, cat, design) if design.get("pv_kwp") and extras else None
        except Exception as e:
            log.warning("optimum failed: %s", e)
        return econ, plaus, opt

    VARIANT_LABEL = {"expert": "PV + storage (as planners here design it)", "independence": "Most independence",
                     "payback": "Best payback", "upfront": "Lowest upfront cost"}

    def variants(self, inp, design, econ) -> list:
        """v1.7: the learned design plus three re-optimised over the installer's own sizes (hourly simulation each).
        Heat pump and wallbox stay as in the expert design; PV is capped at the roof. Preference only reorders."""
        inst = inp["installer_id"]
        clean = roof_to_sim({k: v for k, v in inp.items() if not k.startswith("_")})
        pvs = self.catalogue[inst]["pv"]
        pv0 = design.get("pv_kwp") or float(np.median(pvs))
        cap = (inp.get("roof") or {}).get("max_kwp") or 1e9
        cand = pvs[(pvs >= 0.4 * pv0) & (pvs <= 2.0 * pv0) & (pvs <= cap + 1e-9)]
        if len(cand) > 8:  # 8 PV sizes x the battery packages keeps /api/design under 300 ms
            cand = cand[np.unique(np.linspace(0, len(cand) - 1, 8).round().astype(int))]
        bats = [0.0] + [float(x) for x in self.battery_catalogue(inst, base_features(inp, inst)["t"])]
        keep = {k: design.get(k) for k in ("heatpump_kw", "wallbox_kw")}
        runs = []
        for pv in sorted({float(x) for x in cand} | ({float(design["pv_kwp"])} if design.get("pv_kwp") else set())):
            for bat in bats:
                d = {"pv_kwp": pv, "inverter_kw": rules.inverter_kw(pv), "battery_kwh": bat or None, **keep}
                from . import cashflow
                runs.append((d, cashflow.add(clean, d, hourly.simulate(clean, d).economics)))
        if not runs:
            return []
        best_aut = max(e["autarky_share"] for _, e in runs)
        ind = min((r for r in runs if r[1]["autarky_share"] >= best_aut - 0.01), key=lambda r: r[1]["capex_eur"])
        pay = min((r for r in runs if r[1]["payback_years"]), key=lambda r: (r[1]["payback_years"], r[1]["capex_eur"]), default=None)
        up = min(runs, key=lambda r: (r[1]["capex_eur"], -r[1]["autarky_share"]))
        out = [{"key": "expert", "label": self.VARIANT_LABEL["expert"], "design": design, "economics": econ,
                "note": "The design planners at this installer fit to homes like this one."}]
        for key, r in (("independence", ind), ("payback", pay), ("upfront", up)):
            if r is None:
                continue
            out.append({"key": key, "label": self.VARIANT_LABEL[key], "design": r[0], "economics": r[1],
                        "note": variant_note(r[0], r[1], design, econ)})
        pref = inp.get("preference")
        if pref in ("independence", "payback", "upfront"):
            out.sort(key=lambda v: v["key"] != pref)
        return out

    def _detail(self, comp, size, p, nb, inp, src, pv=None):
        unit = UNITS[comp]
        st = self.nb_stats(nb, comp)
        inc = size is not None and size > 0
        s = nb[TARGET[comp]].values
        agree = float(((s > 0) == inc).mean())
        if inc:
            tol = rules.tolerance(comp, size)
            close = float((np.abs(s[s > 0] - size) <= tol).mean()) if (s > 0).any() else 0.0
            conf = 0.5 * agree + 0.5 * close
        else:
            conf = agree
        if src == "planner":
            conf = 1.0
        vc = pd.Series(np.where(s > 0, s, -1)).value_counts().head(3)
        alts = [{"size": None if v < 0 else float(v), "label": "None" if v < 0 else fmt(float(v), unit),
                 "share": round(c / len(s), 3)} for v, c in vc.items()]
        return {"decision": "include" if inc else "none", "size": float(size) if inc else None, "unit": unit,
                "confidence": round(conf, 2), "reason": self._reason(comp, size, inc, st, inp, src, pv),
                "alternatives": alts, "neighbours": st}

    def _reason(self, comp, size, inc, st, inp, src, pv):
        unit = UNITS[comp]
        n = st["n"]
        k = round(st["share_included"] * n)
        d = inp.get("annual_demand_kwh") or 0
        if src == "planner":
            return f"Set by the planner; {k} of {n} similar homes had {NAMES[comp]}."
        if src == "include" and comp == "heatpump":
            if inp.get("_hp_replacement"):
                return f"Replacement heat pump sized from the heating demand: {fmt(size, unit)} ({rules.heat_load_note(inp)})."
            if inp.get("heating_type") in ("Gas", "Oil"):
                return f"Replaces the {inp['heating_type'].lower()} boiler: {fmt(size, unit)} from the heat load ({rules.heat_load_note(inp)})."
            return f"Included by the planner: {fmt(size, unit)} from the heat load ({rules.heat_load_note(inp)})."
        if src == "include" and comp == "wallbox":
            return f"Included by the planner at {fmt(size, unit)}: the standard size; 22 kW needs grid operator approval."
        if src == "include" and comp != "pv" and comp != "battery":
            return f"Included by the planner at {fmt(size, unit)}."
        if comp == "pv":
            if not inc:
                return f"{n - k} of {n} similar homes got no new PV" + (" (existing system on the roof)." if inp.get("has_solar") else ".")
            ratio = size / max(d / 1000, 0.1)
            return (f"{fmt(size, unit)} is {ratio:.1f} kWp per 1,000 kWh of demand; {k} of {n} similar homes got PV, "
                    f"median {fmt(st['median_size'], unit)}.")
        if comp == "battery":
            if not inc:
                return f"Only {k} of {n} similar homes got a battery."
            return f"{k} of {n} similar homes got a battery, median {fmt(st['median_size'], unit)}; this is {size / max(pv or 1, 1):.1f} kWh per kWp."
        if comp == "heatpump":
            if not inc:
                if inp.get("heating_type") == "Heatpump":
                    return "The home already heats with a heat pump."
                return f"{k} of {n} similar homes got a heat pump from this installer."
            return f"{fmt(size, unit)} from the estimated heat load ({rules.heat_load_note(inp)})."
        if comp == "wallbox":
            ev = "has an EV" if inp.get("has_ev") else "has no EV recorded"
            if not inc:
                if inp.get("has_wallbox"):
                    return "The home already has a wallbox."
                return f"No EV recorded, so no wallbox; {n - k} of {n} similar homes also went without."
            if inp.get("has_ev"):
                return f"The home has an EV, so a wallbox at {fmt(size, unit)}, the standard size (22 kW needs grid operator approval); {k} of {n} similar homes got one."
            return f"The home {ev}; {k} of {n} similar homes got a wallbox."

    def _explain(self, inp, design, comps, nb, econ):
        d = inp.get("annual_demand_kwh") or 0
        out = [f"Sized for {d:,.0f} kWh a year" + (" plus an EV" if inp.get("has_ev") else "") + f", in the style of installer {inp['installer_id']}."]
        for c in COMPONENTS:
            inc = comps[c]["decision"] == "include"
            if inc or c == "battery" or (c == "wallbox" and inp.get("has_ev")) or (c == "pv" and not inc):
                out.append(comps[c]["reason"])
        if econ.get("break_even_year"):
            out.append(f"Breaks even in year {econ['break_even_year']} at {econ['autarky_share'] * 100:.0f}% autarky (simulated).")
        elif econ["payback_years"]:
            how = "Simulated" if econ.get("method") == "hourly-simulation" else "Rough"
            out.append(f"{how} payback {econ['payback_years']:.0f} years at {econ['autarky_share'] * 100:.0f}% autarky.")
        return out[:5]

    # ---------- validate ----------
    def validate(self, inp: dict, design: dict) -> list:
        inst = inp["installer_id"]
        nb = self.neighbours(inp, inst)
        hard = rules.hard_rules(inp, design)
        flags = []
        for comp, key in TARGET.items():
            st = self.nb_stats(nb, comp)
            v = design.get(key)
            inc = v is not None and v > 0
            s = nb[key].values
            level, msg = "ok", None
            if comp in hard:
                level, msg = "implausible", hard[comp]
            elif comp == "wallbox" and inc and v > 11 and not inp.get("has_ev"):
                none, w11 = int((s == 0).sum()), int((s == 11).sum())
                level = "unusual"
                msg = f"{fmt(v, UNITS[comp])} with no EV recorded: {none} of {len(s)} similar homes got no wallbox and {w11} got 11 kW."
            elif inc != (st["share_included"] >= 0.5):
                share = st["share_included"] if inc else 1 - st["share_included"]
                if share < 0.2:
                    level = "unusual"
                    msg = f"Only {round(share * st['n'])} of {st['n']} similar homes " + (f"got {NAMES[comp]}." if inc else f"went without {NAMES[comp]}.")
            elif inc and (s > 0).sum() >= 4:
                lo, hi = np.percentile(s[s > 0], [10, 90])
                if v < lo * 0.9 or v > hi * 1.1:
                    level = "unusual"
                    msg = f"{fmt(v, UNITS[comp])} is outside the range similar homes got ({fmt(lo, UNITS[comp])} to {fmt(hi, UNITS[comp])})."
            if msg is None:
                msg = (f"{fmt(v, UNITS[comp])} is in line with similar homes." if inc else f"No {NAMES[comp].split(' ', 1)[-1]} is in line with similar homes.")
            flags.append({"component": comp, "level": level, "message": msg, "neighbours": st})
        try:
            clean = {k: v for k, v in inp.items() if not k.startswith("_")}
            for p in hourly.validate_physics(clean, {k: design.get(k) for k in ("pv_kwp", "inverter_kw", "battery_kwh", "heatpump_kw", "wallbox_kw")}):
                if p["level"] != "ok":
                    comp = physics_component(p["message"])
                    flags.append({"component": comp, "level": "unusual", "message": p["message"],
                                  "neighbours": self.nb_stats(nb, comp)})
        except Exception as e:
            log.warning("validate_physics failed: %s", e)
        return flags

    def battery_catalogue(self, inst, t):
        """Battery sizes this installer sold at least 3 times within 6 months of the offer date (catalogue changes, e.g. 2025 Q1)."""
        cat = self.catalogue[inst]
        m = np.abs(cat["bat_t"] - t) <= 0.5
        vc = pd.Series(cat["bat_s"][m]).value_counts()
        sizes = np.sort(vc[vc >= 3].index.values.astype(float))
        return sizes if len(sizes) else cat["battery"]

    # ---------- eval ----------
    BASELINES = {"textbook": "1.3 kWp per MWh plus 2.5 kWp with an EV (docs/domain.md rule 1)",
                 "floor_slope": "6.5 kWp plus 0.58 kWp per MWh (median fit, docs/data-insights.md)"}

    def reonic_rule(self, inp: dict) -> dict:
        """Reonic's published rules of thumb (docs and blog): 1 kWp and 1.25 kWh storage per 1,000 kWh annual use incl. EV,
        snapped to the installer's sizes; no heat pump unless asked (no published rule); 11 kW wallbox with an EV
        (grid connection / 1.5, 35 A default); EV default 20,000 km."""
        inst = inp["installer_id"]
        cat = self.catalogue[inst]
        ev = (inp.get("ev_annual_km") or 20000) * 0.18 if inp.get("has_ev") else 0.0
        mwh = ((inp.get("annual_demand_kwh") or 0) + ev) / 1000
        t = base_features(inp, inst)["t"]
        return {"pv_kwp": snap(mwh * 1.0, cat["pv"]), "battery_kwh": snap(1.25 * mwh, self.battery_catalogue(inst, t)),
                "heatpump_kw": 0.0, "wallbox_kw": 11.0 if inp.get("has_ev") else 0.0}

    def planners_kwp_per_mwh(self, inst: str | None = None) -> float:
        """Median kWp per MWh of annual use incl. EV that the planners fitted in signed designs: the rules' fit half, homes
        with real use (untouched 4,500 kWh defaults left out). inst None = both installers."""
        k = f"_pk_{inst}"
        if not hasattr(self, k):
            from .planner_rules import test_ids
            tid = set(test_ids())
            t = self.df[~self.df.project_id.isin(tid) & (self.df.pv_kwp > 0) & ~self.df.annual_demand_kwh.isin([0, 4500])]
            if inst:
                t = t[t.installer_id == inst]
            use = t.annual_demand_kwh + [rules.ev_kwh(r) for r in t.to_dict("records")]
            setattr(self, k, round(float((t.pv_kwp / (use / 1000)).median()), 2) if len(t) else None)
        return getattr(self, k)

    def rule_of_thumb_comparison(self, inp: dict, design: dict) -> dict:
        ev = rules.ev_kwh(inp)
        mwh = ((inp.get("annual_demand_kwh") or 0) + ev) / 1000
        pv = design.get("pv_kwp") or 0
        return {"reonic_kwp_per_mwh": 1.0, "planners_kwp_per_mwh": self.planners_kwp_per_mwh(inp["installer_id"]),
                "this_design_kwp_per_mwh": round(pv / mwh, 2) if mwh else None,
                "note": "Reonic's rule of thumb is about 1 kWp per 1,000 kWh; this installer's planners fit the median shown (signed designs)."}

    def baseline(self, inp: dict, kind: str = "textbook") -> dict:
        cat = self.catalogue[inp["installer_id"]]
        mwh = inp["annual_demand_kwh"] / 1000
        raw = 1.3 * mwh + (2.5 if inp.get("has_ev") else 0) if kind == "textbook" else 6.5 + 0.58 * mwh
        pv = snap(raw, cat["pv"])
        bat = cat["battery_median"] if cat["battery_share"] >= 0.5 else 0.0
        bat = snap(bat, cat["battery"]) if bat else 0.0
        wb = 11.0 if inp.get("has_ev") else 0.0
        return {"pv_kwp": pv, "battery_kwh": bat, "heatpump_kw": 0.0, "wallbox_kw": wb}

    def evaluate(self) -> dict:
        """Main board: new-system jobs (expert fitted PV, or PV is recorded). Battery or wallbox add-ons to PV that the
        status quo does not record are out of scope for a design tool; their numbers are kept in all_projects."""
        te = self.test
        scope = te[(te.pv_kwp > 0) | te.has_solar].reset_index(drop=True)
        out = self._evaluate(scope)
        full = self._evaluate(te.reset_index(drop=True))
        out["split"]["method"] += f"; scored on {len(scope)} new-system test jobs (expert fitted PV or PV recorded), {len(te) - len(scope)} add-on jobs reported in all_projects"
        out["all_projects"] = {"test": len(te), "design_match_share": full["overall"]["design_match_share"],
                               "textbook_design_match_share": full["overall"]["textbook_design_match_share"],
                               "components": {c: full["components"][c]["within_tolerance_share"] for c in COMPONENTS}}
        return out

    def _evaluate(self, te) -> dict:
        rows = te.to_dict("records")
        ours, base, base2 = [], [], []
        for r in rows:
            inp = row_inputs(r)
            d = self.predict_ml(inp, full=False)["design"]  # the scoreboard's main block is the learned chain
            ours.append({k: (d[k] or 0.0) for k in TARGET.values()})
            base.append(self.baseline(inp))
            base2.append(self.baseline(inp, "floor_slope"))
        ours, base, base2 = pd.DataFrame(ours), pd.DataFrame(base), pd.DataFrame(base2)
        baselines = {}
        for name, bdf in (("textbook", base), ("floor_slope", base2)):
            mm = np.ones(len(te), bool)
            bc = {}
            for c in COMPONENTS:
                k = TARGET[c]
                w = rules.within(c, bdf[k].values, te[k].values)
                mm &= w
                inc = te[k].values > 0
                bc[c] = {"within_tolerance_share": round(float(w.mean()), 3),
                         "size_mae": round(float(np.abs(bdf[k].values[inc] - te[k].values[inc]).mean()), 2) if inc.any() else None}
            baselines[name] = {"rule": self.BASELINES[name], "components": bc, "design_match_share": round(float(mm.mean()), 3)}
        ceil = self.ceiling(te)
        comps = {}
        match_o = np.ones(len(te), bool)
        match_b = np.ones(len(te), bool)
        for c in COMPONENTS:
            k = TARGET[c]
            e, o, b = te[k].values, ours[k].values, base[k].values
            wo = rules.within(c, o, e)
            wb_ = rules.within(c, b, e)
            match_o &= wo
            match_b &= wb_
            inc = e > 0
            comps[c] = {
                "decision_accuracy": round(float(((o > 0) == inc).mean()), 3),
                "baseline_decision_accuracy": round(float(((b > 0) == inc).mean()), 3),
                "size_mae": round(float(np.abs(o[inc] - e[inc]).mean()), 2) if inc.any() else None,
                "baseline_size_mae": round(float(np.abs(b[inc] - e[inc]).mean()), 2) if inc.any() else None,
                "unit": UNITS[c],
                "within_tolerance_share": round(float(wo.mean()), 3),
                "baseline_within_tolerance_share": round(float(wb_.mean()), 3),
                "tolerance": rules.TOL_LABEL[c],
            }
            both = inc & (o > 0)
            comps[c]["size_mae_when_both_include"] = round(float(np.abs(o[both] - e[both]).mean()), 2) if both.any() else None
            if c == "pv":
                comps[c]["within_2kwp_share"] = round(float((((o > 0) == inc) & ((~inc) | (np.abs(o - e) <= 2))).mean()), 3)
                comps[c]["baseline_within_2kwp_share"] = round(float((((b > 0) == inc) & ((~inc) | (np.abs(b - e) <= 2))).mean()), 3)
        per = {}
        for inst in INSTALLERS:
            m = (te.installer_id == inst).values
            per[inst] = {"test": int(m.sum()), "design_match_share": round(float(match_o[m].mean()), 3),
                         "baseline_design_match_share": round(float(match_b[m].mean()), 3)}
        dev = []
        for c in ["pv", "battery"]:
            k = TARGET[c]
            err = np.abs(ours[k].values - te[k].values)
            for i in np.argsort(-err)[:10]:
                e, o = te[k].iloc[i], ours[k].iloc[i]
                dev.append({"project_id": te.project_id.iloc[i], "component": c, "ours": float(o) or None,
                            "expert": float(e) or None, "_err": float(err[i]),
                            "note": self._deviation_note(c, rows[i], float(o), float(e))})
        dev = sorted(dev, key=lambda x: -x.pop("_err"))[:20]
        for c in COMPONENTS:
            comps[c]["textbook_within_tolerance_share"] = baselines["textbook"]["components"][c]["within_tolerance_share"]
            comps[c]["floor_slope_within_tolerance_share"] = baselines["floor_slope"]["components"][c]["within_tolerance_share"]
            if c in ceil["components"]:
                comps[c]["ceiling_within_tolerance_share"] = ceil["components"][c]
        return {
            "split": {"train": len(self.train), "test": len(te),
                      "method": f"80/20 stratified by installer, seed {SEED}; {self.excluded['outliers']} outliers dropped ({self.excluded['rule']})"},
            "components": comps,
            "overall": {"design_match_share": round(float(match_o.mean()), 3),
                        "baseline_design_match_share": round(float(match_b.mean()), 3),
                        "textbook_design_match_share": baselines["textbook"]["design_match_share"],
                        "floor_slope_design_match_share": baselines["floor_slope"]["design_match_share"],
                        "ceiling_design_match_share": ceil["design_match_share"],
                        "definition": "PV, battery, heat pump and wallbox all within tolerance at once"},
            "per_installer": per,
            "baselines": baselines,
            "ceiling": {k: ceil[k] for k in ("method", "pv_agreement_share", "battery_agreement_share", "covered_test_share")},
            "deviations": dev,
        }

    NOTE_NAME = {"pv": "Solar", "battery": "Battery", "heatpump": "Heat pump", "wallbox": "Wallbox"}

    def _inbox_note(self, comp, r, ours, expert) -> str:
        """One plain sentence, no quotes or line breaks: what the expert fitted, the draft, and what similar homes got."""
        unit = UNITS[comp]
        s = self.neighbours(row_inputs(r), r["installer_id"])[TARGET[comp]].values
        inc = s[s > 0]
        g = lambda x: f"{x:g}" if x else "none"
        tail = ""
        if len(inc):
            med = float(np.median(inc))
            k = int((np.abs(inc - med) <= rules.tolerance(comp, med)).sum())
            tail = f"; {k} of {len(s)} similar homes got about {med:g}"
        else:
            tail = f"; none of {len(s)} similar homes got one"
        e = f"{expert:g} {unit}" if expert else "none"
        return f"{self.NOTE_NAME[comp]}: expert fitted {e}, draft {g(ours)}{tail}."

    def _deviation_note(self, comp, r, ours, expert) -> str:
        """Neighbour evidence plus the missing input that explains the gap."""
        unit = UNITS[comp]
        inp = row_inputs(r)
        nb = self.neighbours(inp, r["installer_id"])
        s = nb[TARGET[comp]].values
        near = int(((s > 0) & (np.abs(s - expert) <= rules.tolerance(comp, expert or 1))).sum()) if expert else int((s == 0).sum())
        ev = (f"{near} of {len(s)} similar homes got about {fmt(expert, unit)}" if expert else f"{near} of {len(s)} similar homes got none")
        ev += f", median {fmt(float(np.median(s[s > 0])), unit)}" if (s > 0).any() else ""
        why = []
        if comp == "pv":
            if expert and not ours:
                why.append("no PV signal in the inputs (battery and PV jobs look the same)")
            else:
                why.append("inputs lack roof area and orientation")
        if comp == "battery":
            pv = r["pv_kwp"]
            if expert and pv and expert / pv > 1.6:
                why.append(f"expert fitted {expert / pv:.1f} kWh per kWp, well above the usual 1")
            elif not expert:
                why.append("inputs carry no budget signal for skipping the battery")
            else:
                why.append("battery follows the PV size, which the inputs only weakly predict")
        if r["annual_demand_kwh"] == 4500:
            why.append("demand is the 4,500 kWh default")
        return f"Expert fitted {fmt(expert or None, unit)}, draft {fmt(ours or None, unit)}; {ev}; {', '.join(why)}."

    def recommenders_eval(self) -> dict:
        """v2.0: formula (planner_rules), black box (this chain) and textbook, same homes, same tolerances; plus where the
        formula and the expert differ, which design the hourly simulation prefers on payback and autarky."""
        from . import planner_rules
        te = self.test
        board = te[(te.pv_kwp > 0) | te.has_solar].reset_index(drop=True)
        tid = set(getattr(planner_rules, "test_ids", lambda: set())() or [])
        sets = {"board_258": board}
        if tid:
            sets["clean"] = board[board.project_id.isin(tid)].reset_index(drop=True)
        out = {}
        dq = None
        for name, rows_df in sets.items():
            rows = rows_df.to_dict("records")
            e = rows_df
            preds = {"formula": [], "calibrated": [], "band": [], "readout": [], "blackbox": [], "textbook": []}
            for r in rows:
                inp = row_inputs(r)
                preds["formula"].append(self.predict_rules(inp, full=False)["design"])
                preds["calibrated"].append(self.predict_calibrated(inp))
                preds["band"].append(self.predict_band(inp))
                preds["readout"].append(self.predict_readout(inp))
                preds["blackbox"].append(self.predict_ml(inp, full=False)["design"])
                preds["textbook"].append(self.baseline(inp))
            block = {}
            for k, ds in preds.items():
                D = pd.DataFrame([{t: (d.get(t) or 0.0) for t in TARGET.values()} for d in ds])
                w = {c: rules.within(c, D[TARGET[c]].values, e[TARGET[c]].values) for c in COMPONENTS}
                block[k] = {"design_match_share": round(float(np.logical_and.reduce(list(w.values())).mean()), 3),
                            "pv_within": round(float(w["pv"].mean()), 3), "battery_within": round(float(w["battery"].mean()), 3),
                            "wallbox_decision": round(float(w["wallbox"].mean()), 3), "n": len(rows)}
            out[name] = block
            if name == ("clean" if "clean" in sets else "board_258"):
                n = ob_p = eb_p = ob_a = eb_a = 0
                for r, d in zip(rows, preds["formula"]):
                    exp = row_design(r)
                    if all(rules.within(c, [d.get(TARGET[c]) or 0.0], [r[TARGET[c]]])[0] for c in ("pv", "battery")):
                        continue
                    n += 1
                    inp = roof_to_sim(row_inputs(r))
                    eo = hourly.simulate(inp, {**d, "inverter_kw": d.get("inverter_kw") or rules.inverter_kw(d.get("pv_kwp") or 0)}).economics
                    ee = hourly.simulate(inp, {**exp, "inverter_kw": exp.get("inverter_kw") or rules.inverter_kw(exp.get("pv_kwp") or 0)}).economics
                    po, pe = eo.get("payback_years"), ee.get("payback_years")
                    if po and pe and abs(po - pe) >= 0.1:
                        ob_p += po < pe
                        eb_p += pe < po
                    if abs(eo["autarky_share"] - ee["autarky_share"]) >= 0.01:
                        ob_a += eo["autarky_share"] > ee["autarky_share"]
                        eb_a += ee["autarky_share"] > eo["autarky_share"]
                dq = {"n_differ": n, "ours_better_payback": int(ob_p), "expert_better_payback": int(eb_p),
                      "ours_better_autarky": int(ob_a), "expert_better_autarky": int(eb_a),
                      "method": f"Homes where the formula's PV or battery is outside tolerance of the expert's ({name}); both designs run "
                                "through the same hourly simulation; payback differences under 0.1 years and autarky under 1 point count as ties."}
        primary = out.get("clean") or out["board_258"]
        return {"recommenders": {k: {kk: v[kk] for kk in ("design_match_share", "pv_within", "battery_within", "wallbox_decision")} for k, v in primary.items()},
                "recommenders_detail": {name: blk for name, blk in out.items()},
                "recommenders_note": ("clean = homes in the 258-home held-out board that are also in the formula's test half, so neither the "
                                      "black box nor the fitted constants saw them" if "clean" in out else "formula test half not given; board_258 only"),
                "deviation_quality": dq}

    def ceiling(self, te) -> dict:
        """How often near-identical homes got designs within tolerance of each other: the median design of training
        homes with the same installer, demand, EV flag and heating type, scored against each test home."""
        key = ["installer_id", "annual_demand_kwh", "has_ev", "heating_type"]
        cols = list(TARGET.values())
        tr = self.train
        tr = tr[(tr.pv_kwp > 0) | tr.has_solar] if len(te) < len(self.test) else tr  # peers from the same scope as the board
        g = tr.groupby(key)
        med = g[cols].median()[g.size() >= 5].add_suffix("_peer")
        te = te.join(med, on=key)
        t = te[te.pv_kwp_peer.notna()]
        hits = {c: rules.within(c, t[TARGET[c] + "_peer"].values, t[TARGET[c]].values) for c in COMPONENTS}
        allc = np.logical_and.reduce(list(hits.values()))
        return {"pv_agreement_share": round(float(hits["pv"].mean()), 3),
                "battery_agreement_share": round(float(hits["battery"].mean()), 3),
                "components": {c: round(float(h.mean()), 3) for c, h in hits.items()},
                "design_match_share": round(float(allc.mean()), 3),
                "covered_test_share": round(float(len(t) / len(te)), 3),
                "method": "Agreement between near-identical training homes: each test home against the median design of 5 or more "
                          "training homes with identical installer, demand, EV flag and heating type, same tolerance bands as the scoreboard. "
                          "Covers the test homes that have such a group."}


def roof_to_sim(inp: dict) -> dict:
    """Pass a measured roof's orientation and area to the hourly simulation unless the planner gave them."""
    r = inp.get("roof") or {}
    segs = [x for x in r.get("segments") or [] if x.get("azimuth") is not None]
    if not segs or inp.get("roof_azimuth_deg") is not None or inp.get("roof_orientation"):
        return inp
    from .roofs import facing
    big = max(segs, key=lambda x: x["area_m2"])
    out = {**inp, "roof_tilt_deg": inp.get("roof_tilt_deg") or big["pitch"], "roof_area_sqm": inp.get("roof_area_sqm") or r.get("usable_area_m2")}
    if facing(segs) == "east-west":
        out["roof_orientation"] = "east-west"
    else:
        out["roof_azimuth_deg"] = big["azimuth"]
    return out


def _kit(d):
    pv, bat = d.get("pv_kwp") or 0, d.get("battery_kwh") or 0
    return f"{pv:g} kWp" + (f" with {bat:g} kWh" if bat else " with no battery")


def variant_note(d, e, d0, e0) -> str:
    """One sentence against the expert variant, in the homeowner's terms."""
    if (d.get("pv_kwp") or 0) == (d0.get("pv_kwp") or 0) and (d.get("battery_kwh") or 0) == (d0.get("battery_kwh") or 0):
        return f"Same as the planners' design ({_kit(d)})."
    parts = []
    dc = e["capex_eur"] - e0["capex_eur"]
    if abs(dc) >= 50:
        parts.append(f"€{abs(dc):,.0f} {'more' if dc > 0 else 'less'} upfront")
    da = round((e["autarky_share"] - e0["autarky_share"]) * 100)
    if da:
        parts.append(f"{abs(da)} point{'s' if abs(da) > 1 else ''} {'more' if da > 0 else 'less'} independence")
    if e.get("break_even_year") and e0.get("break_even_year"):  # the one "pays back" figure: break-even year
        dp = e["break_even_year"] - e0["break_even_year"]
        if dp:
            parts.append(f"breaks even {abs(dp)} year{'s' if abs(dp) > 1 else ''} {'later' if dp > 0 else 'sooner'}")
    return f"{_kit(d)}: " + (", ".join(parts) if parts else "about the same as the planners' design") + "."


_RULES_MEMO: dict = {}


def _frontier(inputs, catalogue, overrides):
    from .planner_rules import frontier
    return frontier(inputs, None, catalogue, overrides)


def rules_cached(fn, inputs, catalogue, overrides):
    """recommend() takes 0.5 to 0.8 s (a sweep of the home's own physics): memoised per inputs, catalogue and overrides."""
    import hashlib
    import json as _j
    k = hashlib.sha256(_j.dumps([getattr(fn, "__module__", ""), getattr(fn, "__qualname__", repr(fn)),
                                 {kk: v for kk, v in inputs.items() if kk != "roof_model"},
                                 (inputs.get("roof_model") or {}).get("origin_utm32"), catalogue, overrides],
                                sort_keys=True, default=str).encode()).hexdigest()
    if k not in _RULES_MEMO:
        if len(_RULES_MEMO) > 512:
            _RULES_MEMO.clear()
        _RULES_MEMO[k] = fn(inputs, catalogue, overrides)
    return _RULES_MEMO[k]


def with_heat_bound(inp: dict, out: dict) -> dict:
    """The envelope's design heat load is an upper bound (unrenovated IWU U-values on the whole LoD2 volume): when a
    heat figure from the lead or the bill exists, the heat pump is sized from that and the envelope is carried as a bound."""
    env = (inp.get("envelope") or {}).get("design_heat_load_kw")
    if env and (inp.get("heating_demand_kwh") or inp.get("heating_cost_per_year_eur")):
        hp = out["components"]["heatpump"]
        hp["heat_load_upper_bound_kw"] = round(float(env), 1)
        yr = inp.get("house_built_year")
        hp["heat_load_upper_bound_note"] = (f"up to {env:.0f} kW if the {int(yr)} fabric is unrenovated" if yr
                                            else f"up to {env:.0f} kW if the fabric is unrenovated")
    return out


def physics_component(msg: str) -> str:
    m = msg.lower()
    if "battery" in m or "usable" in m or "cycles" in m:
        return "battery"
    if "heat pump" in m:
        return "heatpump"
    if "wallbox" in m:
        return "wallbox"
    return "pv"


def opt_base(g, pv=None):
    """(PV kWp, battery kWh) of the optimum; with pv given, the optimum battery for the nearest catalogue PV size."""
    pvs, bats, npv = g
    if pv is not None:
        i = int(np.argmin(np.abs(pvs - pv)))
        sub = np.full_like(npv, np.nan)
        sub[i] = npv[i]
    else:
        sub = npv
    best = np.nanmax(sub)
    if GREYBOX["base"] == "cheap":  # cheapest design inside the optimum's NPV tie band (app/hourly/optimum.py)
        near = sub >= best - max(NPV_TIE_EUR, NPV_TIE_SHARE * abs(best))
        capex = (pvs * np.array([rules.pv_cost_per_kwp(p) if p else 0 for p in pvs]))[:, None] + 450 * bats[None, :]
        i, j = np.unravel_index(np.argmin(np.where(near, capex, np.inf)), capex.shape)
    else:
        i, j = np.unravel_index(np.nanargmax(sub), sub.shape)
    return float(pvs[i]), float(bats[j])


def gb_floor(v, cat):
    """Optimum as the base of the learned deviation; where the optimum is none, the smallest catalogue size."""
    return float(v) if v > 0 else (float(cat.min()) if len(cat) else 1.0)


def gb_fwd(y, b):
    """Target the regressor learns: the size itself, expert / base (ratio) or expert minus base (residual)."""
    if b is None:
        return y
    return y / b if GREYBOX["mode"] == "ratio" else y - b


def gb_inv(r, b):
    if b is None:
        return r
    return r * b if GREYBOX["mode"] == "ratio" else r + b


def row_inputs(r: dict) -> dict:
    from .data import INPUT_KEYS
    out = {"installer_id": r["installer_id"], "offer_date": r.get("offer_date")}
    for k in INPUT_KEYS:
        v = r.get(k)
        if isinstance(v, float) and np.isnan(v):
            v = None
        out[k] = v
    return out


def row_design(r: dict) -> dict:
    g = lambda k: (float(r[k]) if r.get(k) is not None and not (isinstance(r[k], float) and np.isnan(r[k])) and r[k] > 0 else None)
    return {"pv_kwp": g("pv_kwp"), "inverter_kw": g("inverter_kw"), "battery_kwh": g("battery_kwh"),
            "heatpump_kw": g("heatpump_kw"), "wallbox_kw": g("wallbox_kw")}
