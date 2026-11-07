# ICP and Reonic context (research, 7 Nov 2026)

Pitch target: Reonic's product team. The product is a "Propose design" step inside the offer variant, between energy consumption and Plan PV.

## Reonic today
- Founded 2023, Augsburg (Tristan, Manuel Schneider, Udo Sill). Seed $3m (Point Nine, 2023), Series A about €13m (Northzone, 2024). ARR $1m to $20m in 24 months, 130 staff, 3,000+ installers, 10+ countries. (reonic.com/about; Dealroom Jun 2026; pv magazine 8 Jun 2026)
- Surface: leads, CRM, offers with e-signature, 3D PV planning, simulation (15-minute steps, 20 years, dynamic tariffs), single-line diagram, heat-load calculation with LiDAR scan, installation app, invoicing, customer portal. Services: photogrammetry, KfW handling, Netzanmeldung, Planning Service (Reonic's own planners, 24 or 48 h turnaround, solar only).
- AI shipped: WhatsApp assistant, project summaries, Component AI, Meeting AI, lead scoring, competitor-offer analysis, Call Agent, Sales AI, AI single-line diagram, Validation AI (installer writes rules in plain language; projects checked against them; example rule "storage 0.2 to 0.6 kWh per kWh of daily use"), and since 22 Jun 2026 the AI chat (Cmd+J, voice) that sizes PV, storage and heat pump from the installer's catalogue and past projects, flags missing data, renders variants. Agents on triggers since Sep 2026. (reonic.com/en-gb/ai-chat, /ai-validation, docs.reonic.com/docs/en/ai-agents)
- Design principle, Manuel Schneider: "Im Zweifelsfall sind unsere Produkte immer so entwickelt, den Nutzer zu fragen" (when in doubt, the product asks the user). AI uses the installer's past projects, not generic models. 15% of customers test AI features pre-release. (pv magazine 8 Jun 2026)
- Lead to offer today: lead via CRM, WhatsApp or call agent; AI lead scoring; planner enters consumption plus heat pump and EV load; Quick Planning (no layout) or 3D (Google Solar, OSM Building AI, drone, hand); "Cover roof side" and "Optimieren" give 80 to 90% of the layout; inverter from catalogue; Generate Strings; battery, wallbox, heat pump, add-ons; simulation; sign-off; AI drafts the offer message. The planner still picks every size and variant by hand.
- Roadmap signals: 32 open roles including an AI Product Manager, heat pump GTM, UK and Italy growth PMs.
- Customer quotes: "One click, and a project is validated against all our company guidelines" (Pascal W., Energieversum). "no other tool maps an installer's full workflow like Reonic" (Lennart Pienschke, Resoco).

## What this means for our product
- Reonic already generates sizes from past projects. Our edge is not "learns from history"; it is proof (homes like this one, physics, optimum), honest measurement (held-out, ceiling, baselines), one computed question, and refinement by sentence with the numbers locked.
- Pair with Validation AI: every proposal cites a rule or evidence; the installer's plain-language rules become plausibility checks.
- Per-installer model from signed offers plus catalogue plus package imports; signed vs lost is a free label.
- Intake fields that are usually filled: annual kWh, heat pump interest, EV, roof source; usually missing: meter cabinet, smart meter, heat load. Ask, do not guess (Schneider's rule).
- Business case: Reonic sells human planning at 24 h turnaround; this turns it into minutes and extends it to battery and heat pump.
- Measure: share of proposal surviving planner edits, lead to offer time, validation flags per offer, signed rate by variant.

## Installer reality (sources are vendors or trade press; confirm on site)
- Manual offer 3 to 6 hours, 20 to 45 minutes with software (SurgePV 2026, vendor). Reonic claims "mehrere Stunden" saved per project (pv magazine 2026).
- Customers expect a binding offer in 1 to 2 weeks and a first response within hours (photovoltaik.info 2026; agentino 2026).
- Market: home PV down 25% in 2025 and another 21% in Q1 2026 (BSW, Jan 2026; topagrar 2026); 10 kW system price fell 15% in 2025 to €12,768 (Verivox); home storage €711/kWh H1 2025 (EUPD); heat pumps 299k sold in 2025, +55% (BWP). Over 50% of Reonic's German customers sell heat pumps; for 15% heat pumps out-earn PV.
- Sizes sold: home storage averaged about 11 kWh in 2025 (pv magazine Jan 2026) vs BSW's 7.9 kWh average; about 80% of new home PV comes with a battery (BSW 2026).
- Solarspitzengesetz (Feb 2025): 60% feed-in cap without smart meter; costs 9% of yield on south roofs without a battery (HTW). EEG 2027 draft (not law as of Nov 2026): end of fixed tariff under 25 kW, possible 50% cap. §14a EnWG: heat pumps and wallboxes pick a grid-fee module.
- Quotes for slides: "Viele Betriebe haben sich mit selbstgebauten Excel-Tabellen und Word-Checklisten beholfen" (autarc, pv magazine 2025). "Ein Klick reicht, um quasi alle Angebote zu vergleichen und den Druck auf Installateure zu erhöhen" (Daniel Schmitt, Memodo, pv magazine 2025).
- Reonic expert questions: median lead-to-offer time and Quick vs 3D share; API or export of past offers, catalogue, rules, signed/lost status; Planning Service price and volume; which AI chat features shipped; which intake fields are reliably filled.
