# Domain notes: German single-family PV, battery, heat pump, wallbox

Most sources are installer or comparison blogs (marked "blog"). Treat figures as priors, not truth. Check against the 1,000 designs.

## 1. Installer rules of thumb

PV size per annual demand (kWp per 1,000 kWh):
- 1.0 minimum, 1.2 to 1.5 in practice, 2.0 to 2.5 if heat pump or EV expected: [enter.de? no, reduco.ai](https://reduco.ai/blog/solar/pv-anlage-planen-dimensionieren) (blog, 2026)
- About 2.0: [photovoltaik.info](https://www.photovoltaik.info/pv-speicher-waermepumpe-richtig-dimensionieren/) (2026)
- 1.0 (kWp = MWh/year): [photovoltaik.info](https://www.photovoltaik.info/pv-anlage-dimensionieren-10kwp-10kwh-speicher/) (2026)
- 2.5 (aggressive): [enter.de](https://www.enter.de/blog/pv-anlage-groesse-berechnen) (blog, 2026)
- Spread is 1 to 2.5, so expect the installer data to show wide scatter. Yield about 1,000 kWh/kWp (880 to 1,350): enter.de, same link.

Typical sizes by household (all 2026, blogs):
- 1 to 2 persons, 1,800 to 2,700 kWh: 4 to 6 kWp. 3 to 4 persons, 3,500 to 3,800 kWh: 8 to 10 kWp ([reduco](https://reduco.ai/blog/solar/pv-anlage-planen-dimensionieren)).
- 4 persons with heat pump, about 8,500 kWh: 12 to 15 kWp, 10 to 15 kWh battery. Plus EV, about 11,000 kWh: 15 to 20 kWp, 15 to 20 kWh (same reduco link).
- Additions: EV about +2 kWp, heat pump about +3.5 kWp ([enter.de](https://www.enter.de/blog/pv-anlage-groesse-berechnen)). EV +2.5 kWp, EV plus heat pump suggests 12 to 15 kWp ([photovoltaik.info](https://www.photovoltaik.info/pv-anlage-dimensionieren-10kwp-10kwh-speicher/)).

Battery:
- 1 to 1.5 kWh usable per 1,000 kWh demand ([photovoltaik.info](https://www.photovoltaik.info/pv-speicher-waermepumpe-richtig-dimensionieren/), 2026; Verbraucherzentrale 1.5 per the [search summary of reduco/others](https://reduco.ai/blog/solar/pv-anlage-planen-dimensionieren), 2026).
- About 1 kWh per kWp: 10 kWp with 10 kWh ([photovoltaik.info](https://www.photovoltaik.info/pv-anlage-dimensionieren-10kwp-10kwh-speicher/), 2026).
- With heat pump or EV, 8 to 10 kWh; size classes small 5 to 8, medium 8 to 12, large 12+ kWh ([enter.de](https://www.enter.de/blog/pv-anlage-groesse-berechnen), 2026).
- Skip battery: no hard cut-off in sources. Cases given: tight budget or limited roof, battery can be retrofitted, oversized battery does not pay back ([reduco](https://reduco.ai/blog/solar/pv-anlage-planen-dimensionieren), 2026). Battery adds 5 to 8 years to payback ([photovoltaik.info](https://www.photovoltaik.info/pv-speicher-waermepumpe-richtig-dimensionieren/), 2026).

Heat pump (thermal kW is close to heat load, often chosen slightly below it):
- Heat load by building: new build 30 to 50 W/m2, partly refurbished about 70 W/m2, old build up to 120 W/m2 ([1komma5](https://1komma5.com/de/waermepumpe/leistung-groesse-und-dimensionierung-berechnen), Jan 2026).
- Old unrefurbished stock 100 to 180 W/m2 depending on source; pre-1958 about 180, 1959 to 1968 about 170 ([search digest of homeandsmart, 42watt, BNS](https://www.homeandsmart.de/heizlastberechnung-waermepumpe), 2026). Dimensioning varies a lot, and 240 m2 homes typically 12 to 16 kW ([enter.de](https://www.enter.de/blog/waermepumpe-240-qm-einfamilienhaus), 2026).
- Add about 1 kW for hot water (4 persons x 0.25 kW) ([1komma5](https://1komma5.com/de/waermepumpe/leistung-groesse-und-dimensionierung-berechnen), 2026).
- Electricity added: 3,000 to 5,200 kWh/year (new, JAZ about 4), 5,000 to 7,500 (old, JAZ about 3.2) ([reduco](https://reduco.ai/blog/solar/pv-anlage-planen-dimensionieren), 2026). Air-water JAZ 3.5 to 4.5 ([1komma5](https://1komma5.com/de/waermepumpe/leistung-groesse-und-dimensionierung-berechnen), 2026).

Wallbox:
- 11 kW is the standard: registration only (above 3.7 kW). 22 kW needs grid operator approval; threshold about 12 kVA ([reduco, wallbox](https://reduco.ai/blog/solar/wallbox-anmelden-netzbetreiber), 2026; [Vattenfall](https://www.vattenfall.de/infowelt-energie/wallbox-anmelden)).
- Above 4.2 kW from 1 Jan 2024 falls under controllable-load rules, section 14a EnWG ([Bundesnetzagentur](https://www.bundesnetzagentur.de/DE/Vportal/Energie/E_Mobilitaet/_faq/Wallbox_table.html?nn=653686)).
- EV adds 2,000 to 3,000 kWh/year at 12,000 km ([reduco](https://reduco.ai/blog/solar/pv-anlage-planen-dimensionieren), 2026); 2,500 to 4,000 ([photovoltaik.info](https://www.photovoltaik.info/pv-anlage-dimensionieren-10kwp-10kwh-speicher/), 2026).

## 2. Self-consumption and autarky

- Definitions: self-consumption (Eigenverbrauchsquote) = self-used PV / PV generation; autarky (Autarkiegrad) = self-used PV / household demand. Example 5,000 kWh demand, 6,000 PV, 3,000 self-used: autarky 60%, self-consumption 50% ([Vattenfall](https://www.vattenfall.de/infowelt-energie/solar/autarkie-pv-anlage), Apr 2026).
- HTW Berlin Unabhängigkeitsrechner: inputs are annual demand, kWp, usable battery kWh; outputs autarky and self-consumption ([HTW](https://solar.htw-berlin.de/rechner/unabhaengigkeitsrechner/), undated). It simulates one year at fine time steps, and it is for households without heat pump or EV (separate Solarisator tool covers those; same page). The HTW method page gave no lookup table.
- Typical outcomes: no battery 30 to 40% autarky ([Vattenfall](https://www.vattenfall.de/infowelt-energie/solar/autarkie-pv-anlage), 2026); 20 to 30% self-consumption ([reduco](https://reduco.ai/blog/solar/pv-anlage-planen-dimensionieren), 2026); with battery 50 to 70%; with heat pump control up to 80% ([photovoltaik.info](https://www.photovoltaik.info/pv-speicher-waermepumpe-richtig-dimensionieren/), 2026). 10 kWp with 10 kWh: autarky about 60% ([photovoltaik.info](https://www.photovoltaik.info/pv-anlage-dimensionieren-10kwp-10kwh-speicher/), 2026).
- Battery effect is degressive: first 3 kWh add about 15 points, last 3 kWh about 4 (secondary summary of HTW, via [Solarserver](https://www.solarserver.de/2014/07/17/htw-berlin-entwickelt-rechner-zur-analyse-der-photovoltaik-eigenversorgung-in-kombination-mit-solarstrom-speicher), 2014).
- Useful scaling variable: rho = autarky / self-consumption, about PV generation / load. Low rho (below 0.4) means add PV; high rho (1.0 or more) means add battery ([arXiv 2506.17268](https://arxiv.org/html/2506.17268v1), 2025).
- EV: home-charging at midday raises self-consumption; night charging from grid lowers it. Reonic models the EV as load only, surplus charging assumed when PV and wallbox are planned ([Reonic docs](https://docs.reonic.com/docs/en/offers-simulation-cat-demand-ev), 2026). Heat pump raises winter demand and can lower autarky ([Vattenfall](https://www.vattenfall.de/infowelt-energie/solar/autarkie-pv-anlage), 2026).

## 3. German economics 2026

- EEG feed-in from 1 Aug 2026, ct/kWh: up to 10 kWp 7.70 partial, 12.22 full; 10 to 40 kWp portion 6.66 partial, 10.24 full. Staged, so 15 kWp gets 7.70 on the first 10 kWp ([reduco](https://reduco.ai/blog/einspeiseverguetung-aenderungen-2026-2027), 2026). Previous: 7.78 / 12.34.
- Solarspitzengesetz: systems commissioned from 25 Feb 2025 get no feed-in pay in quarter-hours with negative spot price; without a smart meter, feed-in capped at 60% of rated power; under 2 kWp exempt (same reduco link).
- EEG 2027 draft (not law, cabinet 29 Jul 2026): fixed tariff replaced by 36-month transition payment, about 5.2 ct/kWh at start; 50% grid-feed cap for new rooftop under 100 kW ([homeandsmart](https://www.homeandsmart.de/eeg-2027-einspeiselimit-solaranlage-50-prozent-0023-092143), Aug 2026).
- Household electricity: 37 ct/kWh ([enter.de](https://www.enter.de/blog/pv-anlage-groesse-berechnen), BDEW basis, 2026); roughly 35 to 40 (homeandsmart, above). Reonic default is 0.30 EUR/kWh with 5% annual rise ([Reonic docs](https://docs.reonic.com/docs/en/offers-simulation-cat-energy-flows), 2026).
- PV turnkey, EUR/kWp excl. battery: 5 kWp 1,200 to 1,500; 8 kWp 1,100 to 1,400; 10 kWp 1,000 to 1,300; 15 kWp 900 to 1,200; 20 kWp 850 to 1,150 ([reduco](https://reduco.ai/blog/solar/pv-anlage-planen-dimensionieren), Aug 2026).
- Battery installed: 360 to 510 EUR/kWh average, 300 to 700 market range; 5 kWh 2,500 to 4,000; 10 kWh 5,000 to 7,000; 15 to 20 kWh 8,000 to 12,000 (same link, Verbraucherzentrale index 28 Aug 2026).
- Heat pump air-water, whole job: 25,000 to 40,000 EUR (Verbraucherzentrale RLP via [search digest](https://www.verbraucherzentrale-rlp.de/sites/default/files/2026-02/260210_wp-faktencheck_vzrp.pdf), Feb 2026); 160 real offers 21,099 to 54,168, mean 36,397 ([reduco](https://reduco.ai/blog/heizung/waermepumpe-angebote-vergleichen), 2026). Subsidy 30% base up to 70 to 80% with bonuses on max 28,000 EUR eligible cost; sources conflict, verify at KfW/BAFA.
- 10 kWp plus 10 kWh: 13,000 to 23,100 EUR total, savings 1,900 to 2,100 EUR/year, payback 7 to 11 years ([photovoltaik.info](https://www.photovoltaik.info/pv-anlage-dimensionieren-10kwp-10kwh-speicher/), May 2026). Wallbox 11 or 22 kW from 564 EUR ([reduco](https://reduco.ai/blog/solar/wallbox-11-oder-22-kw), 2026).

## 4. Physical limits

- Roof: 5 to 6 m2 gross per kWp; planning value 5.5; pure module area 4.3 to 4.7; usable share of roof 75 to 90% ([reduco](https://reduco.ai/blog/solar/pv-anlage-planen-dimensionieren), 2026). Other blogs range 4.5 to 8 ([enter.de](https://www.enter.de/blog/pv-anlage-groesse-berechnen), 2026).
- Modules: 430 to 450 Wp TOPCon standard, about 1.95 m2, 2.2 to 2.3 modules per kWp (reduco, same link). 450 to 500 Wp in enter.de.
- Inverter DC/AC 1.1 to 1.3 usual, datasheets allow up to 1.5; 10 kWp on 8 kW (1.25) is the standard single-family case. Clipping loss about 0.2% at 1.1, 0.5 to 0.8% at 1.2, 1.5 to 2.5% at 1.3; above 1.3 only for east-west or shaded roofs ([reduco](https://reduco.ai/blog/solar/wechselrichter-dimensionierung-ueberbelegung), 2026, citing Fraunhofer ISE slide).
- Battery: usable capacity should match evening and morning demand; oversized adds cost without benefit; a large battery cannot make up for small PV ([Vattenfall](https://www.vattenfall.de/infowelt-energie/solar/autarkie-pv-anlage), 2026). Battery as inverter limit: no source found, use C-rate check ourselves.
- Heat pump thermal kW must not exceed the estimated heat load by more than about 20 to 30 percent (our inference; no source stated this).

## 5. ML and kNN on sizing

- No public kNN or installer-design-dataset study found for PV, battery or heat pump choice. Closest:
- Feed-forward neural net sizing PV, wind, battery for homes with fast-charging EV; evaluated by electricity-cost reduction (10.1% vs slow charging, 19.6% vs uncontrolled) and ten uncertainty scenarios ([Chalmers / IEEE TSE](https://research.chalmers.se/publication/533977), 2023).
- Supervised models trained on simulator-generated PV and battery size labels, 40,000x speedup over optimisation ([Gschwendtner/Cambridge-ETH poster](https://juliagsch.github.io/E-Energy_Poster.pdf), year not shown; PDF unreadable here).
- Household type by rho and rule-based simulation with SC and SS metrics on 300 Ausgrid homes ([arXiv 2506.17268](https://arxiv.org/html/2506.17268v1), 2025).
- No source gave tolerance bands. We should define our own, for example PV within +/- 1 kWp or 15%, battery within one size step, heat pump yes/no accuracy plus kW within +/- 2 kW.

## 6. Reonic vocabulary

- Product line: "AI Operating System for Renewable Installers": plan, offers, close deals, manage installation ([Reonic](https://reonic.com/), 2026).
- Planner: "Complete solar planning", 3D roof design, "quick planning mode skips 3D placement for a fast quote" ([Reonic solar](https://reonic.com/en-gb/industry/solar), 2026).
- Offer: quote with profitability calculation, energy simulation and design variants; one offer holds several variants (solar, solar plus battery, plus heat pump) ([Reonic docs](https://docs.reonic.com/docs/en/offers-overview-create-an-offer), 2026).
- Components: modules, inverters, optimisers; battery chosen as a "battery package" under Planning > Battery; "PV packages" bundle module, inverter, optimiser and mounting; "additional" and "optional" components do not enter the simulation ([Reonic docs](https://docs.reonic.com/docs/en/offers-plan-pv-import-package), 2026).
- Heat pump: card "Building and heat load" sized from year of construction, living area, occupants, heat-delivery type; methods "Simple simulation", "Heat load indication", room-by-room per DIN EN 12831 ([Reonic docs](https://docs.reonic.com/docs/en/offers-plan-heat-pump-simple-simulation), Sep 2026).
- Wallbox: no EV load without a vehicle; 11 and 22 kW with load management ([Reonic docs](https://docs.reonic.com/docs/en/offers-simulation-cat-demand-ev), 2026).
- Reonic AI products: Proposal creation, Component specification, Technical validation, Lead scoring (Reonic solar page above). Use "proposal", "variant", "package", "energy flows".

## Rules we can encode

1. PV kWp = 1.0 to 2.0 x annual demand in MWh (base 1.3), plus 2 to 2.5 kWp with EV and 3.5 kWp with heat pump.
2. Total demand = base + heat pump (3,000 to 5,200 new, 5,000 to 7,500 old) + EV (2,000 to 3,000 kWh).
3. PV kWp capped by roof: usable roof m2 x 0.75 to 0.9 / 5.5 m2 per kWp.
4. Residential PV rarely above 20 kWp; 10 kWp is the tariff step (7.70 vs 6.66 ct/kWh).
5. Battery kWh = 1.0 to 1.5 x demand in MWh, and about 1 x kWp, hard cap near 1.5 x kWp.
6. Battery sizes snap to 5, 7.5, 10, 12.5, 15 kWh steps (our assumption from price tiers); none when demand under 3,000 kWh or budget small.
7. Battery cost 360 to 510 EUR/kWh; PV cost 1,000 to 1,300 EUR/kWp at 10 kWp.
8. Inverter AC kW = kWp / 1.1 to 1.3 (default 1.25).
9. Heat pump thermal kW = area x W/m2 (new 40, refurbished 70, old 120) plus 1 kW hot water; round to 2 kW.
10. Heat pump and EV pull battery and PV up; both present means 12 to 20 kWp and 10 to 20 kWh.
11. Wallbox is 11 kW by default, 22 kW only with approval, none without EV.
12. Self-consumption: about 30% with no battery, 50 to 70% with battery, about 60% autarky at 10 kWp with 10 kWh.
13. Feed-in 7.70 ct/kWh up to 10 kWp, 6.66 above; grid price about 37 ct/kWh, so every self-used kWh is worth about 29 ct more than exported.
14. Payback sanity band: 7 to 11 years for PV plus battery; flag designs outside 5 to 15 years.
15. Feed-in at negative prices is zero and capped at 60% without smart meter: do not credit export revenue in those hours.
