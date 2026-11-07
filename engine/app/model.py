"""Chained sizing model: PV, then battery given PV, then heat pump, then wallbox. Statistics plus physics, no LLM."""
import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.model_selection import cross_val_predict, train_test_split

from . import rules
from .data import HEATING_TYPES, INSTALLERS, LOAD_PROFILES, date_t

SEED = 42
K = 15
MODEL_VERSION = "chain-hgb-knn-4"
NO_PV_RULE = "pv"  # "pv": propose PV when a battery would otherwise have none; "battery_none": drop the battery
T_NOW = {"t": 2026.3}  # latest offer date in train; used when a request carries no offer_date
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
        "t": date_t(inp["offer_date"]) if inp.get("offer_date") else T_NOW["t"],
        "demand_default": float(d in (0.0, 4500.0)),
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
        T_NOW["t"] = max(date_t(x) for x in tr.offer_date)
        X = pd.DataFrame([base_features(r, r["installer_id"]) for r in tr.to_dict("records")])
        # offer date picks the battery catalogue only; as a model feature it lowered the scoreboard (README)
        X = X.drop(columns=["t"])
        self.cols = list(X.columns)

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
        self.models["wb_dec"] = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.05, max_depth=3, min_samples_leaf=20, random_state=SEED).fit(X2, y["wallbox"] > 0)
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

        def choose(key, p, size_fn):
            """Planner number/null fixes it; "include" forces it in and the engine sizes it; else the model decides."""
            if key in ov and ov[key] != "include":
                return ov[key] or 0.0, "planner"
            if ov.get(key) == "include":
                return size_fn(), "include"
            return (size_fn() if p >= 0.5 else 0.0), "model"

        # PV
        p_pv = float(self.models["pv_dec"].predict_proba(X)[0, 1])
        pv, src = choose("pv_kwp", p_pv, lambda: snap(float(self.models["pv_size"].predict(X)[0]), cat["pv"]))
        comps["pv"] = self._detail("pv", pv, p_pv, nb, inp, src)
        # battery
        X1 = X.assign(pv=pv)
        p_b = float(self.models["bat_dec"].predict_proba(X1)[0, 1])
        bat, src = choose("battery_kwh", p_b, lambda: snap(float(self.models["bat_size"].predict(X1)[0]), self.battery_catalogue(inst, f["t"])))
        # a battery needs PV to charge: without PV, new or recorded, propose PV or drop the battery
        nopv_note = None
        if bat and not pv and not inp.get("has_solar") and src == "model":
            if NO_PV_RULE == "pv" and "pv_kwp" not in ov:
                pv = snap(float(self.models["pv_size"].predict(X)[0]), cat["pv"])
                comps["pv"] = self._detail("pv", pv, p_pv, nb, inp, "model")
                comps["pv"]["reason"] = f"A battery needs PV to charge and none is recorded, so PV is proposed; {comps['pv']['reason']}"
                X1 = X.assign(pv=pv)
                bat = snap(float(self.models["bat_size"].predict(X1)[0]), self.battery_catalogue(inst, f["t"]))
            else:
                bat, nopv_note = 0.0, "No PV, new or recorded, so no battery: it could not charge from solar."
        comps["battery"] = self._detail("battery", bat, p_b, nb, inp, src, pv=pv)
        if nopv_note:
            comps["battery"]["reason"] = nopv_note
        X2 = X1.assign(battery=bat)
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
                         lambda: 22.0 if float(self.models["wb_size"].predict_proba(X2)[0, 1]) >= 0.5 else 11.0)
        comps["wallbox"] = self._detail("wallbox", wb, p_w, nb, inp, src)

        inv = ov["inverter_kw"] if isinstance(ov.get("inverter_kw"), (int, float)) else rules.inverter_kw(pv)
        design = {"pv_kwp": pv or None, "inverter_kw": inv if pv else None, "battery_kwh": bat or None,
                  "heatpump_kw": hp or None, "wallbox_kw": wb or None}
        econ = rules.economics(inp, design)
        plaus = rules.plausibility(inp, design, econ)
        return {"design": design, "explanation": self._explain(inp, design, comps, nb, econ),
                "components": comps, "plausibility": plaus, "economics": econ, "model_version": MODEL_VERSION}

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
            what = "Replaces the existing heat pump" if inp.get("_hp_replacement") else "Included by the planner"
            return f"{what}; {fmt(size, unit)} from the heat load ({rules.heat_load_note(inp)})."
        if src == "include" and comp != "pv" and comp != "battery":
            return f"Included by the planner at {fmt(size, unit)}, the size this installer fits most for homes like this."
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
            if inp.get("has_ev") and k < n / 2:
                return f"The home has an EV, so a wallbox at {fmt(size, unit)}; {k} of {n} similar homes got one."
            return f"The home {ev}; {k} of {n} similar homes got a wallbox, most often {fmt(st['median_size'], unit)}."

    def _explain(self, inp, design, comps, nb, econ):
        d = inp.get("annual_demand_kwh") or 0
        out = [f"Sized for {d:,.0f} kWh a year" + (" plus an EV" if inp.get("has_ev") else "") + f", in the style of installer {inp['installer_id']}."]
        for c in COMPONENTS:
            inc = comps[c]["decision"] == "include"
            if inc or c == "battery" or (c == "wallbox" and inp.get("has_ev")) or (c == "pv" and not inc):
                out.append(comps[c]["reason"])
        if econ["payback_years"]:
            out.append(f"Rough payback {econ['payback_years']:.0f} years at {econ['autarky_share'] * 100:.0f}% autarky.")
        return out[:5]

    # ---------- validate ----------
    def validate(self, inp: dict, design: dict) -> list:
        inst = inp["installer_id"]
        nb = self.neighbours(inp, inst)
        rules = rules.hard_rules(inp, design)
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
        te = self.test
        rows = te.to_dict("records")
        ours, base, base2 = [], [], []
        for r in rows:
            inp = row_inputs(r)
            d = self.predict(inp)["design"]
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
        ceil = self.ceiling()
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

    def _deviation_note(self, comp, r, ours, expert) -> str:
        """Neighbour evidence plus the missing input that explains the gap."""
        unit = UNITS[comp]
        inp = row_inputs(r)
        nb = self.neighbours(inp, r["installer_id"])
        s = nb[TARGET[comp]].values
        near = int((np.abs(s - expert) <= rules.tolerance(comp, expert or 1)).sum()) if expert else int((s == 0).sum())
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
        return f"Expert {fmt(expert or None, unit)}, ours {fmt(ours or None, unit)}. {ev}; {', '.join(why)}."

    def ceiling(self) -> dict:
        """How often near-identical homes got designs within tolerance of each other: the median design of training
        homes with the same installer, demand, EV flag and heating type, scored against each test home."""
        key = ["installer_id", "annual_demand_kwh", "has_ev", "heating_type"]
        cols = list(TARGET.values())
        g = self.train.groupby(key)
        med = g[cols].median()[g.size() >= 5].add_suffix("_peer")
        te = self.test.join(med, on=key)
        t = te[te.pv_kwp_peer.notna()]
        hits = {c: rules.within(c, t[TARGET[c] + "_peer"].values, t[TARGET[c]].values) for c in COMPONENTS}
        allc = np.logical_and.reduce(list(hits.values()))
        return {"pv_agreement_share": round(float(hits["pv"].mean()), 3),
                "battery_agreement_share": round(float(hits["battery"].mean()), 3),
                "components": {c: round(float(h.mean()), 3) for c, h in hits.items()},
                "design_match_share": round(float(allc.mean()), 3),
                "covered_test_share": round(float(len(t) / len(te)), 3),
                "method": "Each test home against the median design of 5 or more training homes with identical installer, "
                          "demand, EV flag and heating type; same tolerance bands as the scoreboard. Covers the test homes that have such a group."}


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
