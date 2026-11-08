# Brief: copy sweep (P1, Xander, Sun 8 Nov 2026 about 02:40 Munich)

One Sonnet agent, copy only, on branch `copy-sweep` from main: planner, homeowner and Check. Rewrite every user-visible string and send a before/after ledger (file, old, new) to Hack Chief-of-Staff for Xander's veto before any merge. No layout, icon, colour or logic changes. Do not touch `web/components/systems/**` or any `KitSheet` file (other lanes own them).

Kill: middle dots "·" and spaced ellipses as separators; robot key-values ("Electric car: Yes, 15,000 km" becomes "Electric car, 15,000 km a year"); unit case and spacing ("15,000 km", "kWp", "kWh", "kW"); em dashes; "not X, it's Y"; fragment-then-explainer pairs; taglines and isocolons; mechanism narration and unprompted reassurance; copy repeating a visible title or action; buzzword adverbs and verbs (seamlessly, effortlessly, quietly, elevate, unlock, empower); emojis; "AI-powered"; placeholder-looking numbers; research jargon in UI ("rules-4", "band", "LoD2", "textbook") except on Check, where it is evidence.

Keep material facts beside the action: price, estimate marks, "N of 9 facts stated".

Voice: a German installer's planner talking to a colleague. British spelling. One fact per sentence.

Acceptance: `grep` over `web/` finds zero "·", "—", "KM" and no emoji in user-visible strings; `npx tsc --noEmit` clean. Own small deploy after the ledger is accepted.
