"""Chained sizing model: PV, then battery given PV, then heat pump, then wallbox. Statistics plus physics, no LLM."""
import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.model_selection import cross_val_predict, train_test_split

from . import physics
from .data import HEATING_TYPES, INSTALLERS, LOAD_PROFILES

SEED = 42
K = 15
MODEL_VERSION = "chain-hgb-knn-1"
COMPONENTS = ["pv", "battery", "heatpump", "wallbox"]
UNITS = {"pv": "kWp", "battery": "kWh", "heatpump": "kW", "wallbox": "kW"}
TARGET = {"pv": "pv_kwp", "battery": "battery_kwh", "heatpump": "heatpump_kw", "wallbox": "wallbox_kw"}
NAMES = {"pv": "PV", "battery": "a battery", "heatpump": "a heat pump", "wallbox": "a wallbox"}


def base_features(inp: dict, installer: str) -> dict:
    d = float(inp.get("annual_demand_kwh") or 0)
    f = {
        "inst": INSTALLERS.index(installer),
        "demand": d,
        "log_demand": math.log1p(d),
        "has_ev": float(bool(inp.get("has_ev"))),
        "ev_km": inp.get("ev_annual_km") if inp.get("ev_annual_km") is not None else np.nan,
        "has_wallbox": float(bool(inp.get("has_wallbox"))),
        "has_solar": float(bool(inp.get("has_solar"))),
        "solar_kwp": inp.get("existing_solar_kwp") if inp.get("existing_solar_kwp") is not None else np.nan,
        "has_storage": float(bool(inp.get("has_storage"))),
        "storage_kwh": inp.get("existing_storage_kwh") if inp.get("existing_storage_kwh") is not None else np.nan,
        "heat_cost": inp.get("heating_cost_per_year_eur") if inp.get("heating_cost_per_year_eur") is not None else np.nan,
        "heat_demand": inp.get("heating_demand_kwh") if inp.get("heating_demand_kwh") is not None else np.nan,
        "price": inp.get("electricity_price_ct_kwh") if inp.get("electricity_price_ct_kwh") is not None else np.nan,
        "inhabitants": inp.get("num_inhabitants") if inp.get("num_inhabitants") is not None else np.nan,
        "sqm": inp.get("house_size_sqm") if inp.get("house_size_sqm") is not None else np.nan,
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


def snap(x: float, cat: np.ndarray) -> float:
    if x is None or len(cat) == 0:
        return x
    return float(cat[np.argmin(np.abs(cat - x))])


def fmt(x, unit):
    if x is None:
        return "None"
    s = f"{x:,.1f}".rstrip("0").rstrip(".")
    return f"{s} {unit}"


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
        self.train, self.test = tr.reset_index(drop=True), te.reset_index(drop=True)
        tr = self.train
        X = pd.DataFrame([base_features(r, r["installer_id"]) for r in tr.to_dict("records")])
        self.cols = list(X.columns)

        for inst in INSTALLERS:
            t = tr[tr.installer_id == inst]
            vc_pv = t[t.pv_kwp > 0].pv_kwp.round(2).value_counts()
            vc_b = t[t.battery_kwh > 0].battery_kwh.value_counts()
            vc_hp = t[t.heatpump_kw > 0].heatpump_kw.value_counts()
            vc_wb = t[t.wallbox_kw > 0].wallbox_kw.value_counts()
            self.catalogue[inst] = {
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
            self.knn[inst] = {"V": (V - mu) / sd * KNN_W, "mu": mu, "sd": sd, "rows": t.reset_index(drop=True)}

        y = {c: tr[TARGET[c]].values for c in COMPONENTS}
        clf = lambda: HistGradientBoostingClassifier(max_iter=200, learning_rate=0.05, max_depth=4, min_samples_leaf=15, random_state=SEED)
        reg = lambda: HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_depth=4, min_samples_leaf=15, loss="absolute_error", random_state=SEED)

        # PV
        self.models["pv_dec"] = clf().fit(X, y["pv"] > 0)
        m = y["pv"] > 0
        self.models["pv_size"] = reg().fit(X[m], y["pv"][m])
        pv_oof = np.where(cross_val_predict(clf(), X, y["pv"] > 0, cv=5) , cross_val_predict(reg(), X, y["pv"], cv=5), 0.0)
        X1 = X.assign(pv=pv_oof)
        # battery given PV
        self.models["bat_dec"] = clf().fit(X1, y["battery"] > 0)
        m = y["battery"] > 0
        self.models["bat_size"] = reg().fit(X1[m], y["battery"][m])
        bat_oof = np.where(cross_val_predict(clf(), X1, y["battery"] > 0, cv=5), cross_val_predict(reg(), X1, y["battery"], cv=5), 0.0)
        X2 = X1.assign(battery=bat_oof)
        # heat pump: too few sold to learn a size; decision from data, size from physics
        self.hp_positive = int((y["heatpump"] > 0).sum())
        self.models["hp_dec"] = clf().fit(X2, y["heatpump"] > 0) if self.hp_positive >= 5 else None
        # wallbox
        self.models["wb_dec"] = clf().fit(X2, y["wallbox"] > 0)
        m = y["wallbox"] > 0
        self.models["wb_size"] = clf().fit(X2[m], y["wallbox"][m] > 11)
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
    def predict(self, inp: dict, overrides: dict | None = None) -> dict:
        inst = inp["installer_id"]
        if inst not in self.catalogue:
            raise ValueError(f"Unknown installer_id {inst}")
        ov = overrides or {}
        cat = self.catalogue[inst]
        f = base_features(inp, inst)
        X = pd.DataFrame([f])[self.cols]
        nb = self.neighbours(inp, inst)
        comps, design = {}, {}

        # PV
        p_pv = float(self.models["pv_dec"].predict_proba(X)[0, 1])
        if "pv_kwp" in ov:
            pv = ov["pv_kwp"] or 0.0
            src = "planner"
        else:
            pv = snap(float(self.models["pv_size"].predict(X)[0]), cat["pv"]) if p_pv >= 0.5 else 0.0
            src = "model"
        comps["pv"] = self._detail("pv", pv, p_pv, nb, inp, src)
        # battery
        X1 = X.assign(pv=pv)
        p_b = float(self.models["bat_dec"].predict_proba(X1)[0, 1])
        if "battery_kwh" in ov:
            bat, src = ov["battery_kwh"] or 0.0, "planner"
        else:
            bat = snap(float(self.models["bat_size"].predict(X1)[0]), cat["battery"]) if p_b >= 0.5 else 0.0
            src = "model"
        comps["battery"] = self._detail("battery", bat, p_b, nb, inp, src, pv=pv)
        X2 = X1.assign(battery=bat)
        # heat pump
        p_h = float(self.models["hp_dec"].predict_proba(X2)[0, 1]) if self.models.get("hp_dec") else 0.0
        if "heatpump_kw" in ov:
            hp, src = ov["heatpump_kw"] or 0.0, "planner"
        else:
            hp = snap(physics.heatpump_kw(inp), cat["heatpump"]) if p_h >= 0.5 else 0.0
            src = "model"
        comps["heatpump"] = self._detail("heatpump", hp, p_h, nb, inp, src)
        # wallbox
        p_w = float(self.models["wb_dec"].predict_proba(X2)[0, 1])
        if "wallbox_kw" in ov:
            wb, src = ov["wallbox_kw"] or 0.0, "planner"
        else:
            if p_w >= 0.5:
                wb = 22.0 if float(self.models["wb_size"].predict_proba(X2)[0, 1]) >= 0.5 else 11.0
            else:
                wb = 0.0
            src = "model"
        comps["wallbox"] = self._detail("wallbox", wb, p_w, nb, inp, src)

        inv = ov.get("inverter_kw") if "inverter_kw" in ov else physics.inverter_kw(pv)
        design = {"pv_kwp": pv or None, "inverter_kw": inv if pv else None, "battery_kwh": bat or None,
                  "heatpump_kw": hp or None, "wallbox_kw": wb or None}
        econ = physics.economics(inp, design)
        plaus = physics.plausibility(inp, design, econ)
        return {"design": design, "explanation": self._explain(inp, design, comps, nb, econ),
                "components": comps, "plausibility": plaus, "economics": econ, "model_version": MODEL_VERSION}

    def _detail(self, comp, size, p, nb, inp, src, pv=None):
        unit = UNITS[comp]
        st = self.nb_stats(nb, comp)
        inc = size is not None and size > 0
        s = nb[TARGET[comp]].values
        agree = float(((s > 0) == inc).mean())
        if inc:
            tol = physics.tolerance(comp, size)
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
            return f"{fmt(size, unit)} from the estimated heat load ({physics.heat_load_note(inp)})."
        if comp == "wallbox":
            ev = "has an EV" if inp.get("has_ev") else "has no EV recorded"
            if not inc:
                return f"The home {ev}; {n - k} of {n} similar homes got no wallbox."
            return f"The home {ev}; {k} of {n} similar homes got a wallbox, most often {fmt(st['median_size'], unit)}."

    def _explain(self, inp, design, comps, nb, econ):
        d = inp.get("annual_demand_kwh") or 0
        out = [f"Sized for {d:,.0f} kWh a year" + (" plus an EV" if inp.get("has_ev") else "") + f", in the style of installer {inp['installer_id']}."]
        for c in COMPONENTS:
            out.append(comps[c]["reason"])
        if econ["payback_years"]:
            out.append(f"Rough payback {econ['payback_years']:.0f} years at {econ['autarky_share'] * 100:.0f}% autarky.")
        return out[:5]

    # ---------- validate ----------
    def validate(self, inp: dict, design: dict) -> list:
        inst = inp["installer_id"]
        nb = self.neighbours(inp, inst)
        rules = physics.hard_rules(inp, design)
        flags = []
        for comp, key in TARGET.items():
            st = self.nb_stats(nb, comp)
            v = design.get(key)
            inc = v is not None and v > 0
            s = nb[key].values
            level, msg = "ok", None
            if comp in rules:
                level, msg = "implausible", rules[comp]
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
        return flags

    # ---------- eval ----------
    def baseline(self, inp: dict) -> dict:
        cat = self.catalogue[inp["installer_id"]]
        pv = snap(inp["annual_demand_kwh"] / 1000, cat["pv"])
        bat = cat["battery_median"] if cat["battery_share"] >= 0.5 else 0.0
        bat = snap(bat, cat["battery"]) if bat else 0.0
        wb = 11.0 if inp.get("has_ev") else 0.0
        return {"pv_kwp": pv, "battery_kwh": bat, "heatpump_kw": 0.0, "wallbox_kw": wb}

    def evaluate(self) -> dict:
        te = self.test
        rows = te.to_dict("records")
        ours, base = [], []
        for r in rows:
            inp = row_inputs(r)
            d = self.predict(inp)["design"]
            ours.append({k: (d[k] or 0.0) for k in TARGET.values()})
            base.append(self.baseline(inp))
        ours, base = pd.DataFrame(ours), pd.DataFrame(base)
        comps = {}
        match_o = np.ones(len(te), bool)
        match_b = np.ones(len(te), bool)
        for c in COMPONENTS:
            k = TARGET[c]
            e, o, b = te[k].values, ours[k].values, base[k].values
            wo = physics.within(c, o, e)
            wb_ = physics.within(c, b, e)
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
                "tolerance": physics.TOL_LABEL[c],
            }
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
                            "note": f"Expert {fmt(e or None, UNITS[c])}, ours {fmt(o or None, UNITS[c])}; demand {te.annual_demand_kwh.iloc[i]:,.0f} kWh"
                                    + (", EV" if te.has_ev.iloc[i] else "") + "."})
        dev = sorted(dev, key=lambda x: -x.pop("_err"))[:20]
        return {
            "split": {"train": len(self.train), "test": len(te),
                      "method": f"80/20 stratified by installer, seed {SEED}; {self.excluded['outliers']} outliers dropped ({self.excluded['rule']})"},
            "components": comps,
            "overall": {"design_match_share": round(float(match_o.mean()), 3),
                        "baseline_design_match_share": round(float(match_b.mean()), 3),
                        "definition": "PV, battery, heat pump and wallbox all within tolerance at once"},
            "per_installer": per,
            "deviations": dev,
        }


def row_inputs(r: dict) -> dict:
    from .data import INPUT_KEYS
    out = {"installer_id": r["installer_id"]}
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
