# Brief: kit sheet (P1, Xander, Sun 8 Nov 2026 about 04:00 Munich)

Replace the kit diagram on the planner card and the homeowner "Your system" with a Lego-instruction-sheet parts list. Xander on the current one: "a flow chart, two lines of AI copy, then three rows repeating the same thing". Kill the flow chart, the explanatory copy and the duplicate rows entirely. Nothing else on the Offer panel changes.

Layout: one row per component. Each row = a small rendered icon of the real component (a stack of modules, a wall inverter, a battery tower, a wallbox, a heat pump outdoor unit, a meter cabinet), the quantity large on the left like "23×", then the name and the one spec that matters: "Solar module 450 Wp", "Hybrid inverter 8 kW", "Battery storage 10 kWh", "Wallbox 11 kW", "Heat pump 9 kW". Icons are dynamic: the module stack height tracks count bands, the battery tower tracks kWh; a component not in the design is not shown. Mirror the real German Angebot line order: modules, inverter, storage, wallbox, heat pump, then mounting and electrics as one "Installation" line, then the total (price labelled estimate as before).

Icons come from the same GLB component models used in the 3D scene (an off-screen render reusing the pooled renderer and thumbnail path) or Icon Composer-style flat renders of them, so the list and the house match. One shared component `web/components/offer/KitSheet.tsx` used by both surfaces; lane 4 switches the homeowner "Your system" to it.

Owner: the Offer agent (branch kit-sheet from origin/main; owns web/components/offer/**). Homeowner switch: lane 4 after the push. Preview to the Chief-of-Staff for 390 and 1440. Renderer-adjacent if the icons are GL-rendered: own deploy after a visible-Safari pass.
