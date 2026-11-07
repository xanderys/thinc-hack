# Lead qualification: is this lead worth a site visit?

The installer can see which leads deserve a visit before they spend a planner's afternoon on one. The planner then arrives already knowing the likely answer, so the scan confirms the design instead of starting it.

Every number here is an estimate until the site visit, and the card says so.

## The rule

One pure function, `qualify(lead, design, roof)` in `web/lib/qualify.ts`, over what the web already has: the lead's facts and status, the engine's draft (design and economics) and the roof lookup for the address (`GET /api/roof`). No model, no LLM. Rules run in this order and the first that fires decides.

1. **Decline** when the homeowner declined the offer.
2. **Call first** when the building is multi-unit (a flat in a block): "Call first: is this a house or a flat? Shared roof, single-family design does not apply." Multi-unit means Zensus 2022 shows 3 or more dwellings in the building, or the building's floor (footprint times storeys) is far larger than the floor area the lead states (`isMultiUnit` in `web/lib/building.ts`).
3. **Decline** when the measured roof cannot carry a system: every face points north (within 60 degrees of north and steeper than 10 degrees), or the usable roof fits under 3 kWp (the engine's `max_kwp`, which already leaves north faces out). The sentence names the reason ("Decline: the roof fits only 2.4 kWp, under 3 kWp.").
4. **Call first** when the roof is not measured: no street address ("Call first: roof not measured, ask the address."), the 3D lookup is still running ("roof being measured"), or the address finds no building.
5. **Decline** when nothing fits or the draft does not pay back within 20 years.
6. **Call first** when one more fact would change the design: annual use is the 4,500 kWh default, or the heating type is unknown while a heating bill is given.
7. **Visit** otherwise: "Visit: 10.35 kWp fits, payback 10 years, 7 of 9 facts stated."

Nine facts are counted as stated or not: address, annual use, people, floor area, build year, heating type, heating bill, electric car, preference. A fact the engine filled from the address (floor area, build year from Zensus) counts as estimated, not stated. The roof is listed as measured or estimated beside them and never counted.

The card also carries:
- **Expected offer value**: the draft's investment rounded to 100 EUR, labelled "estimate"; "No offer" on Decline.
- **Confidence**: "7 of 9 facts stated, roof measured from the address, consumption from the bill".
- **After a call**: Rina's summary line on the planner's card carries the verdict and the expected value.
- **Board**: grouped Visit, Call first, Decline, a live call first in its group. A card shows "Checking" until its roof answers; the last verdict per lead is kept for the session so a reopen does not flicker.
- **Confirm on site**: roof condition and shade (estimate from the surface model), meter and grid connection, and the location of each device the draft includes (battery, heat pump, wallbox).

The engine stays frozen tonight, so the rule lives in the web. Porting it to the engine after the hackathon is an issue.

## How others do it

- Reonic scores each lead 0 to 100 when AI lead scoring is on, with signals for property (neighbourhood, roof suitability), contact quality and intent; its sales page shows separate scores for project readiness, property quality, customer profile and solar potential, plus budget and urgency signals. The weights are not published. Our verdict covers the property and readiness parts with a reason a planner can act on, and leaves sentiment and budget to the call. Sources: [Reonic docs, lead scoring](https://docs.reonic.com/docs/en/leads-lead-characteristics-lead-scoring), [Reonic AI sales](https://reonic.com/en-gb/ai-sales/).
- Aurora qualifies a customer remotely from the address in about ten minutes (roof, LIDAR shade, a bill for usage) and reports that remote assessment avoids a repeat site survey on about 20% of projects (vendor figure). Sources: [Aurora, qualify a new customer in 10 minutes](https://aurorasolar.com/resources/how-to-qualify-a-new-customer-in-10-minutes-using-aurora/), [Aurora, lead capture AI](https://aurorasolar.com/blog/get-solar-leads-hooked-with-lead-capture-ai-customizations).
- OpenSolar's lead flow captures the address, usage (or a bill upload) and an optional roof drawing, then opens a project; we found no published automatic roof or qualification gate. Source: [OpenSolar AI Lead Gen](https://www.opensolar.com/ai-lead-gen/).
- Sales guides agree that shade and roof suitability need confirming on site, which is why every verdict here is an estimate until the visit. Source: [SurgePV, solar lead qualification](https://www.surgepv.com/blog/solar-lead-qualification).
