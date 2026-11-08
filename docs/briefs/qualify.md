# Brief: lead qualification (visit verdict)

Decided by Xander, Sat 7 Nov 2026 about 22:20 Munich. Branch `qualify`. One Opus agent. Rule-based, honest, labelled. No ML.

Why (Xander): "we are trying to qualify leads by creating this energy system output, not just for the sake of the physics model, but to see whether it is even worth doing an on-site visit." Line to carry: "The installer can see which leads deserve a visit before they spend a planner's afternoon on one. And the planner arrives already knowing the likely answer, so the scan confirms the design instead of starting it." Honesty rule: our numbers are estimates until the site visit, and the UI says so.

Where the rule lives tonight: `web/lib/qualify.ts`, one pure function over what the web already has (HomeInputs, DesignResponse incl. economics and plausibility, RoofResult, lead facts and status). The engine is frozen until 07:29 and a verdict that cannot be tested on production before 08:00 is a stage risk, so the engine port comes after the hackathon (filed as an issue). The rule is written once and documented in `docs/qualification.md`.

1. VISIT VERDICT per lead, three values with one sentence each:
   - VISIT: worth a planner's afternoon. "Visit: 10.35 kWp fits, payback 10 years, 7 of 9 facts stated."
   - CALL FIRST: one fact would change it, name the fact. "Call first: roof not measured, ask the address." Also when annual use is the 4,500 default, heating type unknown on a big heating bill, or the roof lookup is pending.
   - DECLINE: no viable system: roof capacity under about 3 kWp or north-only faces, payback beyond 20 years, or the homeowner declined. Always with the reason.
   Inputs: roof capacity and usable faces (from the address), draft size and investment, payback and autarky, facts stated vs estimated (confidence), homeowner preference and timeline from the call.
2. EXPECTED OFFER VALUE on the card (draft investment, labelled "estimate") and a CONFIDENCE chip ("7 of 9 facts stated, roof measured from the address, consumption from the bill"). Every estimated value carries "estimate until the site visit".
3. BOARD sorts and groups by verdict (Visit / Call first / Decline), live call first. Demo: hero (Visit), a postcode-only lead (Call first: "roof not measured, ask the address"), a north-roof or tiny-roof lead (Decline, with the reason). Scratch leads are created via POST /api/leads and named as real homeowners, never "Test"; the agent reports their ids.
4. CARD header shows the verdict and the sentence; SITE VISIT NOTE at the end of the Offer stage: "Confirm on site: roof condition and shade (estimate from the surface model), meter and grid connection, battery location."
5. Rina's post-call summary on the planner's card includes the verdict and the expected value.

Owned files: `web/lib/qualify.ts`, `web/components/qualify/**`, `docs/qualification.md`; the board component for sorting; minimal hooks in `Chain.tsx` (header line, Offer note, call summary) taken last after a rebase on `origin/web`, where another agent is regrouping the chain. Never touch demo lead db67b84935 beyond reading it.
