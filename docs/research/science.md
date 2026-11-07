# Sizing science and ML evidence (research, 7 Nov 2026)

## Sizing rules and where practice departs
- HTW Berlin Stromspeicher-Inspektion 2025: battery only if PV exceeds 0.5 kWp per MWh/a; usable storage at most the smaller of 1.5 kWh per kWp and 1.5 kWh per MWh/a; the installer rule "1 kWh per kWp or more" is "nicht ratsam". Forecast-based charging keeps feed-in-cap losses under 2% and extends battery life about 2 years (worth at least €800 on 10 kWh). (solar.htw-berlin.de, 2025)
- Worms BNS Study B 2026 (NPV-maximising Monte Carlo): optimum 0.7 to 1.0 kWh/kWp for household load, 1.0 to 1.5 with heat pump and EV; "1 kWh/kWp is confirmed". The optimum moves with the objective and the load. Our data: median 0.97 kWh/kWp.
- HTW for Verbraucherzentrale NRW 2019: fill the roof rather than match consumption. Our data: 2.0 kWp per MWh median, textbook 1.3 under-sizes 82%.
- Dynamic tariffs (§41a EnWG since 1 Jan 2025): with 10 kWh, +12.7% net gains even without price-aware control (Lorenz, Bayer, Pruckner, Energy Policy 2025). EV households gain most from dynamic tariffs; heat pump plus PV homes still do best on self-consumption (Stute et al., Fraunhofer ISI 2024). 573 negative-price hours in 2025 (BNetzA Jan 2026).
- Heat pump field data: air-source JAZ mean 3.1 to 3.3, ground-source 3.6 to 5.2 (Fraunhofer ISE 2020, 2024). About 10% of 1,023 field heat pumps oversized, about 1% undersized (Brudermueller et al., Nature Communications 2025). Median rated output about 1.5x real heat load; a 4 kW reserve costs about €8,000 (ISE via cleanthinking Oct 2026). Our engine: kW = heat MWh / 2.3, JAZ 3.4.
- Joint optimisation precedents: von Appen and Braun (IEEE TEC 2019), Nordgård-Hansen et al. (Applied Energy 2021), Hesse et al. (Energies 2017).

## Learning from expert decisions, ceilings, human-AI
- Learning design strategies from historical human data without an explicit objective: Raina, McComb, Cagan (J. Mech. Design 2019).
- Modern kNN is on par with CatBoost across 300 datasets (Ye et al., ModernNCA, 2024): the 15-neighbour evidence is a model in its own right.
- Explanation by similar cases: Nugent and Cunningham (AI Review 2005); clinicians valued similar-case retrieval most for trust (arXiv 2502.20478, 2025); Zillow shows the top ten comps.
- Inter-annotator agreement is not a hard ceiling; a well-specified model can beat noisy experts (Richie et al., BioNLP 2022). Frame our "near-identical homes agree 31.7%" as noise, not a limit.
- German PV quotes vary widely for similar systems (Kraschewski et al., 19,561 quotes, Energy Economics 2023): installer labels are noisy.
- People use imperfect algorithms if they can modify them even slightly (Dietvorst et al., Management Science 2018); numeric uncertainty costs little trust (van der Bles et al., PNAS 2020); explanations raise acceptance whether or not the AI is right (Bansal et al., CHI 2021), so the proof must be real.
- Which missing input to ask for next: active feature acquisition (Aronsson et al., IJCAI 2026); clarifying questions as expected information gain minus the cost of asking (ACL 2026, arXiv 2601.06407).
- Small tabular data: TabPFN v2 beats tuned ensembles under 10,000 rows (Hollmann et al., Nature 2025); TabArena 2025: foundation models win on small data, GBDT stays strong, ensembles best. Conformal intervals: CQR (Romano et al. 2019), jackknife+ (Barber et al. 2021).

## German market numbers
- 560,000 home batteries in 2025 averaging 7.9 kWh; about 80% of new home PV with a battery; about 40% of new home PV bought with a heat pump or EV (BSW-Solar, Jan 2026). About 454,000 new home PV systems in 2025, down 28% (pv magazine Dec 2025). 10 to 20 kWp systems rose from 3% of new capacity in 2020 to 22% in 2023 (Fraunhofer ISE 2024). No authoritative median kWp for new single-family systems exists; compute from MaStR if needed.

## Claims with a citation (for slides and Q&A)
1. HTW caps sensible storage at min(1.5 kWh/kWp, 1.5 kWh/MWh) and rejects "1 kWh/kWp" (HTW 2025).
2. With heat pump and EV the NPV optimum moves to 1.0 to 1.5 kWh/kWp (Worms 2026).
3. Dynamic tariffs add 12.7% to a 10 kWh battery's net gain (Lorenz et al. 2025).
4. Air-source JAZ in existing homes averages 3.1 to 3.3 (Fraunhofer ISE 2020, 2024).
5. About 10% of field heat pumps are oversized (Brudermueller et al. 2025).
6. Installer labels are noisy (Kraschewski et al. 2023); expert agreement is not a hard ceiling (Richie et al. 2022).
7. Editable proposals reduce algorithm aversion (Dietvorst et al. 2018).
8. Showing numeric uncertainty costs little trust (van der Bles et al. 2020).
9. kNN evidence is competitive with boosted trees (Ye et al. 2024).
10. BSW average home battery 7.9 kWh in 2025; our installers default to 9 and 10 kWh.

## Methods worth adding if there were time
Jackknife+ or CQR size intervals (2 h); TabPFN v2 vs our chain with grouped CV by installer (3 h); noise ceiling from the 15 nearest twins (2 h); VOI picker that narrows the conformal interval (4 h); optimum under 2025 day-ahead prices with zero pay in negative hours (3 h).
