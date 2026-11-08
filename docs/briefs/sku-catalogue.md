# Brief: SKU catalogue (P1, Xander, Sun 8 Nov 2026 about 09:50 Munich; must merge by 11:30)

One catalogue for all installers (never per installer, no "Installer A/B" wording anywhere), built at build time from `project_options_parts.csv` (data pack, outside the repo) by `engine/app/catalogue.py` into a JSON of aggregates the web reads: per component type the real SKUs with brand, name, size and frequency. Expected content: batteries Huawei LUNA 5 / 7 / 10 kWh, EcoFlow 5 / 7 / 10, Sigenergy AIOS 9 / 18, SAJ, Enphase, SolarEdge; inverters Sigenergy Hybrid 5 / 10 / 20 kW, Huawei, GoodWe, EcoFlow; wallboxes Huawei, EcoFlow, Sigenergy AC 11 kW (22 where present); modules Sunpro 463 W TOPCon glass-glass (plus 480 / 455 W variants), AIKO, Trina; heat pumps Vaillant 5.5 / 7.5 / 10.5 / 12.5 kW, Aira. The JSON holds names, sizes and counts only (no project rows).

Behaviour
1. Lead designs snap to the catalogue ladder (battery 5 / 7 / 9 / 10 / 18 kWh, inverters 5 / 10 / 20 kW, heat pumps 5.5 / 7.5 / 10.5 / 12.5 kW, modules in 463 W steps) so every kWp, kWh and kW on screen is a real SKU. The sealed exam path stays unsnapped (its figures are published); snapping applies to lead designs, variants and refines.
2. Kit sheet rows name brand plus SKU plus size ("Huawei LUNA 10 kWh", "Sigenergy Hybrid Inverter 10 kW", "Sunpro 463 W TOPCon module", "Vaillant 10.5 kW"); the default brand is the most common brand for that part and size in the data.
3. The size chooser gains a brand row (Huawei / EcoFlow / Sigenergy for batteries, and so on); a brand switch is an override like a size change (persists, Undo, Complete carries it).
4. The rate card keeps the market rate per kWp or kWh (the data has no prices) but labels the SKU.
5. The homeowner "Your system" shows the same SKU names.
6. On-model unit pills show the size only.

Engine: `design.components[]` (or the kit rows) carry `sku: {brand, name, size, share}`; overrides accept `sku_<part>: "<brand>"`; api v2.15. Web: Offer lane owns the kit sheet, chooser brand row, rate card label and the homeowner rows. Consequence to accept: the hero's figures move with the ladder (23 × 463 W = 10.65 kWp, inverter 10 kW, price), so DECK re-shoots and renumbers after the final deploy; the sealed 18.6 % on 633 is unchanged because the exam path does not snap.
