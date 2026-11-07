# The experts, read out as rules

How the two installers in the data pack size a system, recovered from their signed designs and written as rules a planner can check. Module `engine/app/planner_rules/rules4.py` (`rules-4-readout`): one depth-3 tree per installer for PV and one for the battery (given the PV), fitted on the fit half (654 new-system jobs, seed 42, the same ids as `engine/lab/split`). Every leaf holds the size that the most signed designs in it match within tolerance; leaves that agree are merged. Re-fit and print: `cd engine && uv run python -m app.planner_rules.rules4`. "n of N" below counts the fit-half homes in the leaf that the rule matches; the lab reports the out-of-fold share per rule from `rules_fired`.

Tolerance: PV ±1 kWp or ±15%, battery ±2 kWh, heat pump and wallbox decisions exact.

## Installer A (2a8ba8e2, 491 jobs in the fit half)

**PV**
- Use up to 3,550 kWh a year (household plus EV), not heating with a heat pump: 6.3 kWp. 51 of 111.
- Use up to 3,550 kWh, heating with a heat pump: 8.1 kWp. 12 of 22.
- Use 3,550 to 12,600 kWh: 10.35 kWp (23 modules). 142 of 337.
- Use over 12,600 kWh: 18 kWp. 8 of 17.

**Battery**
- PV up to 7.2 kWp: 5 kWh. 63 of 111.
- PV over 7.2 kWp, use up to 12,600 kWh: 9.2 kWh, which in practice means the 10 kWh package (the tolerance covers 7 to 11 kWh). 162 of 363.
- PV over 7.2 kWp, use over 12,600 kWh: 14 kWh. 6 of 17.

## Installer B (23c108b7, 163 jobs)

**PV**
- Use up to 2,900 kWh: 6.75 kWp. 6 of 15.
- Use 2,900 to 3,750 kWh: 7.2 kWp. 14 of 36.
- Use 3,750 to 8,950 kWh: 11.7 kWp (26 modules). 58 of 97.
- Use over 8,950 kWh: 13.05 kWp. 8 of 15.

**Battery**
- PV up to 9.45 kWp: 9 kWh up to 6.97 kWp, 10 kWh above. 29 of 51.
- PV over 9.45 kWp: 9 kWh up to 4,550 kWh of use, 10 kWh above. 71 of 97.
- Use over 8,950 kWh: 15 kWh. 6 of 15.

## Both installers
- **Wallbox:** 11 kW when there is an electric car. 74.8% of homes are matched. 22 to 25% of homes without an EV still got one (24% at A, 25% at B), and 57 to 67% of EV homes did. No input in the data predicts which; no principle found.
- **Heat pump:** none unless the planner asks, or gas or oil heats the home and the boiler is 20 years or older. 99.2% are matched; 13 of 1,619 projects in the pack have a heat pump.
- **Inverter:** the catalogue size nearest 0.85 times the PV kWp. Installer A records no inverter; B's median is 0.89 times PV.
- **Existing kit:** no PV when the home has PV; no battery when it has storage.

## Principle behind each rule

| Rule | Principle | Source |
|---|---|---|
| A standard array (A 10.35, B 11.7 kWp) for most homes, whatever the use above about 3,600 kWh | Fill a standard roof face. At about 883 EUR per extra kWp (fixed costs already paid), an extra kWp exported at 7.7 ct for 20 years is worth about 1,000 to 1,200 EUR discounted after upkeep, so the margin still pays above own use. The hourly physics agrees: its knee lies at 9.9 kWp for the hero | [reduco 2026 size table](https://reduco.ai/blog/solar/solaranlage-kosten-nach-groesse-kwp); EEG feed-in from 1 Aug 2026 (`docs/domain.md`); `docs/rules.md` |
| Smaller arrays below about 3,600 kWh | The roof face is not filled when use is small, though the margin would still pay. The likely reasons are a smaller house and budget, but the data has neither | inferred, not in the data |
| Heat pump homes get a larger array at low use | More electricity use than the household figure shows | the heat pump's own electricity (seasonal COP 3.4, Fraunhofer ISE 2025) |
| Battery is the installer's package nearest about 0.7 to 1.0 kWh per kWp (5 kWh for small arrays, 9 to 10 kWh for standard ones) | Size storage to the array, at most 1.5 kWh per 1,000 kWh of use | HTW Berlin rule of thumb via [finanztip](https://www.finanztip.de/daily/stromspeicher-zur-pv-anlage-so-gross-darf-er-hoechstens-sein/) |
| Battery on 95 to 99% of jobs | Storage is sold with nearly every array | data; buyers value self-supply at a median 29 ct per kWh ([Kaps and Netessine, Operations Research](https://doi.org/10.1287/opre.2024.1104)) |
| Wallbox prior about 23%, regardless of the EV flag | none found | data |
| No heat pump unless asked | PV installers rarely sell them | data: 13 of 1,619 projects |

## Each lever's effect (5-fold CV on the fit half, 654 jobs; gains under about 2.5 points are noise; lab paired test: rules-3 vs rules-1 p 0.15 to 0.90)

| Lever | PV | Battery | Wallbox | All four |
|---|---|---|---|---|
| rules-1-calibrated: base array plus share of use, battery kWh per kWp (production) | 36.7% | 46.8% | 74.8% | 16.2% |
| rules-4-readout: these rules, A and B separate | 38.7% | 48.2% | 74.8% | 17.0% |
| rules-4 with the battery snapped to the packages on sale at the offer date | 38.7% | 48.3% | 74.8% | 17.0% |
| rules-4 with A and B pooled into one rule set | 41.7% | 58.0% | 74.8% | 21.7% |
| the same, battery snapped to each installer's own packages | 41.7% | 47.1% | 74.8% | 17.7% |
| rules-3-band: most common design per installer and use band | 39.3% | 49.7% | 74.8% | 18.0% |
| Median of the 10 / 15 / 30 nearest signed designs | 38.1 / 38.2 / 37.1% | 50.0 / 48.6 / 50.5% | 74.8% | 16.1 / 16.8 / 17.7% |
| Blend: rules-4 unless the 15 nearest disagree by more than one package step (PV: beyond tolerance), then their median | 39.0% | 48.5% | 74.8% | 16.8% |

The pooled rule set's 21.7% is a tolerance artefact. Pooled, Installer A gets 9 kWh, B's pack, which A never sells. A 9 kWh battery sits within ±2 kWh of both A's 7 and 10 kWh packages, so it is scored right on both. Snapped to A's own packages, it falls back to 17.7%. It is rejected. The blend does not help either: where the rules and the neighbours disagree, neither is reliably right. Production stays on rules-1, and these rules are the wording of its Rules block.

## The honest ceiling
The inputs carry about 18 to 20% of whole designs: the band table, fitted and scored on the same homes, reaches only 20.3%. Transparent rules reach this level, and so does the black box; nothing honest goes further. Three things in the data set the limit:
- Roof size and budget are not recorded.
- 17 to 19% of homes carry the 4,500 kWh default in place of a real use figure.
- The wallbox decision is unpredictable for a quarter of homes.

With an address, the engine adds the roof (LoD2 planes, max kWp) as a cap. The exam cannot test this, because it is roof-blind by necessity.
