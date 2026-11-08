# Brief: component views (Xander, Sun 8 Nov 2026 11:00 Munich)

Panels already show the metric that sizes them (per-module shade, sun scrubber). Battery, wallbox and heat pump get the same pattern: a scrubber strip over the canvas and headline figures that move with the size ladder. Cut: battery ships first and fully; wallbox and heat pump ride the same strip and the same payload and ship only if green by 12:00. Merge by 12:10 at the latest. Lanes: ENGINE - Marquee (`engine/`), web lane `views` (Opus, worktree `~/Projects/thinc-hack-wt/views`, owns `web/components/systems/strip/**` and the Battery, Wallbox and Heat pump card bodies in `web/components/systems/**`), units lane (`web/components/spatial/**`: exposes `scene.setBatteryFill(0..1)`, `scene.setCarCharge(0..1)`, `scene.setXrayHour(h)` and nothing else).

## Engine: `GET /api/leads/{id}/day?day=summer|winter&battery_kwh=&wallbox_kw=&heatpump_kw=` (v2.18, additive, cached per lead version and sizes)
Returns one typical day at hourly resolution from the same simulation the economics use (PVGIS typical year; summer = the median June day, winter = the coldest week's median day):
```
{ day, hours: 24,
  solar_kwh[24], load_kwh[24],                       // household load without EV and heat pump
  battery: { kwh, soc[24] (0..1), charge_kwh[24], discharge_kwh[24], hours_after_sunset_covered, self_sufficiency_share, ladder: [5,7,9,10,18], by_size: {kwh: {hours_after_sunset_covered, self_sufficiency_share}} },
  wallbox: { kw, ev_kwh_year, charging_kwh[24], solar_share_of_charging, full_charge_hours, ladder: [11, 22], by_size: {kw: {solar_share_of_charging, full_charge_hours}} } | null,
  heatpump: { kw, heat_demand_kwh[24], outdoor_temp_c[24], heat_load_kw, heating_kwh_year, electricity_kwh_year, cop, cost_eur_year, boiler_cost_eur_year, ladder: [5.5,7.5,10.5,12.5], by_size: {kw: {electricity_kwh_year, cost_eur_year}} } | null,
  sunrise_h, sunset_h }
```
`null` when the part is not in the design and no size is asked for. Figures are the engine's; the web never computes them.

## Web
One shared strip component (24 h axis, sunrise and sunset ticks, an hour scrubber shared with the panels scrubber's look, summer or winter toggle) with three series sets. Battery card: the strip (solar, load, battery filling and draining), headline **hours after sunset covered** and **self-sufficiency %** that tween when the ladder changes; the 3D battery's fill follows the scrubbed hour. Wallbox card: ev kWh a year, charging windows on the strip, **share of charging from own solar**, **full charge in X h** at 11 or 22 kW; the car's charge glyph follows the scrubber. Heat pump card: heat demand against outdoor temperature on the winter strip, **heat load kW**, annual heating kWh and electricity kWh at the COP, cost beside the gas or oil bill; the x-ray tint follows the hour. No copy beyond figures and short labels. Skeleton shimmer while the day loads. British English, no em dashes.
