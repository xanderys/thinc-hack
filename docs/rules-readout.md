# The experts, read out as rules

How the two installers in the data pack size a system, recovered from their signed designs and written as rules a planner can check. Module `engine/app/planner_rules/rules4.py` (`rules-4-readout`): one depth-3 tree per installer for PV and one for the battery (given the PV), fitted on the fit half (654 new-system jobs, seed 42, the same ids as `engine/lab/split`). Every leaf holds the size that the most signed designs in it match within tolerance; leaves that agree are merged. Re-fit and print: `cd engine && uv run python -m app.planner_rules.rules4`. "n of N" below counts the fit-half homes in the leaf that the rule matches; the lab reports the out-of-fold share per rule from `rules_fired`.

Tolerance: PV ±1 kWp or ±15%, battery ±2 kWh, heat pump and wallbox decisions exact.

Each rule shows the fit-half homes it matches (n of N) and the share it holds out of fold (5-fold CV). Rules under 30% out of fold are marked weak. Minimum leaf 25 homes.

## Installer A (2a8ba8e2, 491 jobs in the fit half)

**PV**
- Use up to 2,856 kWh a year (household plus EV): 6.3 kWp. 23 of 48, out of fold 40%.
- Use 2,856 to 3,550 kWh: 8.1 kWp. 39 of 85, out of fold 31%.
- Use 3,550 to 9,100 kWh: 10.35 kWp (23 modules). 132 of 315, out of fold 38%.
- Use over 9,100 kWh: 12.15 kWp. 15 of 39, out of fold 36%.

**Battery**
- Use up to 4,100 kWh: 5 kWh. 91 of 190, out of fold 35 to 50%.
- Use 4,100 to 10,850 kWh: 9.2 kWh, which in practice is the 10 kWh package (the tolerance covers 7 to 11). 130 of 274, out of fold 46%.
- Weak: use over 10,850 kWh, 14 kWh. 10 of 27, out of fold 18%.

## Installer B (23c108b7, 163 jobs)

**PV**
- Use up to 3,750 kWh: 7.2 kWp. 20 of 51, out of fold 33%.
- Use over 3,750 kWh: 11.7 kWp (26 modules). 64 of 112, out of fold 53%.

**Battery**
- Use up to 3,900 kWh: 10 kWh. 31 of 54, out of fold 57%.
- Use 3,900 to 6,550 kWh: 10 kWh when use is given (36 of 48, out of fold 73%), and 9 kWh when the lead gives no use (24 of 31, out of fold 76%).
- Use over 6,550 kWh: 9 kWh. 12 of 30, out of fold 38%.

## Both installers
- **Wallbox:** 11 kW when there is an electric car. 74.8% of homes are matched. 22 to 25% of homes without an EV still got one (24% at A, 25% at B), and 57 to 67% of EV homes did. No input in the data predicts which; no principle found.
- **Heat pump:** none unless the planner asks, or gas or oil heats the home and the boiler is 20 years or older. 99.2% are matched; 13 of 1,619 projects in the pack have a heat pump.
- **Inverter:** the catalogue size nearest 0.85 times the PV kWp. Installer A records no inverter; B's median is 0.89 times PV.
- **Existing kit:** no PV when the home has PV; no battery when it has storage.

## Principle behind each rule

| Rule | Principle | Source |
|---|---|---|
| A standard array (A 10.35, B 11.7 kWp) for most homes above about 3,600 kWh of use | Fill a standard roof face. At about 883 EUR per extra kWp (fixed costs already paid), an extra kWp exported at 7.7 ct for 20 years is worth about 1,000 to 1,200 EUR discounted after upkeep, so the margin still pays above own use. The hourly physics agrees: its knee lies at 9.9 kWp for the hero | [reduco 2026 size table](https://reduco.ai/blog/solar/solaranlage-kosten-nach-groesse-kwp); EEG feed-in from 1 Aug 2026 (`docs/domain.md`); `docs/rules.md` |
| Smaller arrays below about 3,600 kWh | The roof face is not filled when use is small, though the margin would still pay. The likely reasons are a smaller house and budget, but the data has neither | inferred, not in the data |
| Heat pump homes get a larger array at low use | More electricity use than the household figure shows | the heat pump's own electricity (seasonal COP 3.4, Fraunhofer ISE 2025) |
| The battery is the installer's package, about 0.7 to 1.0 kWh per kWp: 5 kWh for small homes, 9 to 10 kWh for standard ones | Size storage to the array, at most 1.5 kWh per 1,000 kWh of use | HTW Berlin rule of thumb via [finanztip](https://www.finanztip.de/daily/stromspeicher-zur-pv-anlage-so-gross-darf-er-hoechstens-sein/) |
| Battery on 95 to 99% of jobs | Storage is sold with nearly every array | data; buyers value self-supply at a median 29 ct per kWh ([Kaps and Netessine, Operations Research](https://doi.org/10.1287/opre.2024.1104)) |
| Wallbox prior about 23%, regardless of the EV flag | none found | data |
| No heat pump unless asked | PV installers rarely sell them | data: 13 of 1,619 projects |

## Each lever's effect (5-fold CV on the fit half, 654 jobs; gains under about 2.5 points are noise; lab paired test: rules-3 vs rules-1 p 0.15 to 0.90)

| Lever | PV | Battery | Wallbox | All four |
|---|---|---|---|---|
| rules-1-calibrated: base array plus share of use, battery kWh per kWp | 36.7% | 46.8% | 74.8% | 16.2% |
| rules-4-readout: these rules, A and B separate, minimum leaf 25 (production) | 39.6% | 48.3% | 74.8% | 17.6% |
| rules-4 (minimum leaf 15) with the battery snapped to the packages on sale at the offer date | 38.7% | 48.3% | 74.8% | 17.0% |
| rules-4 with A and B pooled into one rule set | 41.7% | 58.0% | 74.8% | 21.7% |
| the same, battery snapped to each installer's own packages | 41.7% | 47.1% | 74.8% | 17.7% |
| rules-3-band: most common design per installer and use band | 39.3% | 49.7% | 74.8% | 18.0% |
| Median of the 10 / 15 / 30 nearest signed designs | 38.1 / 38.2 / 37.1% | 50.0 / 48.6 / 50.5% | 74.8% | 16.1 / 16.8 / 17.7% |
| Blend: rules-4 unless the 15 nearest disagree by more than one package step (PV: beyond tolerance), then their median | 39.0% | 48.5% | 74.8% | 16.8% |

The pooled rule set's 21.7% is a tolerance artefact. Pooled, Installer A gets 9 kWh, B's pack, which A never sells. A 9 kWh battery sits within ±2 kWh of both A's 7 and 10 kWh packages, so it is scored right on both. Snapped to A's own packages, it falls back to 17.7%. It is rejected. The blend does not help either: where the rules and the neighbours disagree, neither is reliably right. Production runs rules-4-readout (hero unchanged at 10.35 kWp, 8 kW, 10 kWh). The black box scores 15.3% out of fold on the fit half (lab), below every rule set.

## The honest ceiling
The inputs carry about 18 to 20% of whole designs: the band table, fitted and scored on the same homes, reaches only 20.3%. Transparent rules reach this level, and so does the black box; nothing honest goes further. Three things in the data set the limit:
- Roof size and budget are not recorded.
- 17 to 19% of homes carry the 4,500 kWh default in place of a real use figure.
- The wallbox decision is unpredictable for a quarter of homes.

With an address, the engine adds the roof (LoD2 planes, max kWp) as a cap. The exam cannot test this, because it is roof-blind by necessity.

## rules-5: Reonic's textbook first, the planners as corrections
Module `engine/app/planner_rules/rules5.py` (`rules-5-textbook-corrected`; `rules5.textbook()` is Reonic alone). Every component starts from a rule Reonic publishes (blog and docs). A correction is the planners' ratio to that rule, or their standard array, per group of homes. It is fitted on the fit half and kept only if it raises 5-fold CV there by at least half a point. Minimum group 25 homes.

| Rule | Reonic textbook | Your planners (fit half) |
|---|---|---|
| PV | 1.0 kWp per MWh of use, at 980 kWh per kWp; orientation factors; 85% of the roof; at most 30 kWp | A: standard 10.35 kWp array (179 of 488); 2.3 to 2.4 kWp per MWh at 2,500 to 4,499 kWh; 1.7 at 4,500 to 5,500; 10.35 kWp at 5,500 to 7,000; 1.4 at 7,000 to 9,000; 1.2 above. B: standard 11.9 kWp (82 of 163); 3.65 at 2,500 to 3,500; 2.6 at 3,500 to 4,500 |
| Battery | 1.0 to 1.5 kWh per MWh; 0.2 to 0.6 kWh per kWh a day | kWh per kWp of the array, snapped to the installer's packages: A 0.8 before 2025, 1.075 from 2025; B 0.85. Reonic's other rule, storage about the array's kWp, is what the planners follow |
| Heat pump | W per m2 by build class plus 0.5 kW per person | rules-1's decision (gas or oil, boiler 20 years or older); Reonic's size |
| Wallbox | grid connection / 1.5: 35 A gives 11 kW | 11 kW with an EV. Without one, 24 to 25% got one at both installers and in both eras, so no prior flips the rule |
| Inverter | DC/AC 1.1 to 1.3 | B's recorded ratio is 1.19; A records none |

5-fold CV on the fit half (654 jobs):

| | PV | Battery | All four |
|---|---|---|---|
| Reonic textbook alone | 11.5% | 32.7% | 5.4% |
| Textbook plus corrections (rules-5) | 41.9% | 50.9% | 17.9% |
| rules-4-readout (production) | 39.6% | 48.3% | 17.6% |

The dimensions were chosen on the same folds, so the rules-5 figure is slightly optimistic. Gains under about 2.5 points are noise.

Tested and dropped (no CV gain): EV, heating type, load profile, electricity price and household size, for both PV and battery; use band for the battery. The battery correction needs the offer date; without it, battery falls to 45.4%.

Patterns found:
- Both installers sell in whole 450 W modules (A 99.6%, B 94.5% of designs). B's 10.8 kWp is 24 modules; 10.8 kWp is the most common size at both.
- There is no bunching below the 10 kWp feed-in tier (48 designs at 9 to 10 kWp, 115 at 10 to 11), and none above 30 kWp.
- The batteries miss Reonic's daily band in a structured way. The ratio falls with use (1.26 kWh per kWh a day under 2,500 kWh, 0.37 above 9,000) because storage tracks the array, not the use.
- Heat pumps: 5 in the fit half, 4 of them replacing gas, oil or another fossil system.
