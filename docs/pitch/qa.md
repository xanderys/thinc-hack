# Jury Q&A

Draft v1. Every number here must match the final deck.

1. **38.5% sounds low. Why is that good?**
   Two planners agree on identical homes only 40.3% of the time, so that is the ceiling the data allows. We reach 38.5%; the textbook rule reaches 14.6%. On all four components: 19.1% against a ceiling of 22.7%.

2. **How do you know it is not overfitting?**
   20% of projects are held out, stratified by installer, fixed seed, and never used for fitting, size snapping or neighbours. Every score is on those homes.

3. **Where is the AI? Is this just an LLM?**
   No language model makes any sizing decision. A chained model (gradient boosting for PV, then battery given PV, then heat pump, then wallbox) plus nearest neighbours for evidence and confidence. The LLM only turns a planner's sentence into input changes.

4. **Why chained instead of one model?**
   The decisions are coupled: battery value depends on PV size. A planner override on one stage re-sizes the stages after it, the way an expert would.

5. **What limits accuracy?**
   Inputs. Roof area, household size and budget are not in the data; demand alone explains 15% of PV variance. Two intake fields are the cheapest accuracy gain.

6. **How does it handle "no battery" or "no heat pump"?**
   Each stage first decides include or none, then sizes. None is a normal answer.

7. **Is it plausible for homes unlike the data?**
   Sizes snap to what the installer actually sells, and physics checks (heat load, inverter ratio, autarky) keep results in range.

8. **What is the business case?**
   [UNCONFIRMED: Jamon's figures]

9. **Why would Reonic build this rather than a team like you?**
   [UNCONFIRMED: Xander to answer; draft: it is a feature inside Reonic's planner, trained on Reonic's own data; we built the proof that it works.]

10. **What would you do with another month?**
    Per-installer style across all 3,000+ installers, the two intake fields, the validation view, then the homeowner view on the same engine.

## Does anyone already feed installed-system data back into design?
We found no public product that does. 1KOMMA5° Heartbeat connects 50,000 to 60,000 systems, but uses them to trade power, not to size new systems (1KOMMA5° press release, 14 Nov 2025). Reonic holds both the offer and the installed system, so it can close that loop.
Sources: https://1komma5.com/de/magazin/pressemitteilungen/heartbeat-ai-verfuegbar-fuer-millionen-bestehender-energiesysteme/ and https://api.energy-charts.info/
Words: "replay" for what we built, "closed loop" for the roadmap. Never "world model", never "nobody does".

## How do you know the model behaves sensibly on homes it has never seen?
[UNCONFIRMED: Xander to approve] Metamorphic, simulation-verified testing: 10,000 synthetic homes built from the real inputs, with the hourly physics as the oracle, 1.2 million simulations. Fixes shipped on 7 Nov took monotonicity violations from 3,135 to 740. "More demand never lowers PV" holds 99.8% of the time (was 91.4%), and "a higher tariff never shrinks the battery" holds 92.6% (was 73.7%). Plausible designs: 99.6%. Bad inputs caught: 75.7% (was 51.1%). Caveat: since the fix the model sizes batteries a little larger, so 27% sit inside HTW Berlin's storage cap, against 34% for real experts; the physics optimum shown next to each design makes the gap visible. Never say "physics-informed neural network". Source: docs/synthetic.md.

## Is it really 8 days of work?
No. The 8 days is median calendar time from enquiry to offer at one installer (23c108b7, 260 projects with both dates in the Reonic export, request_created_at to offer_created_at), and it includes waiting. Marquee removes the design and draft step, not the site visit. Offer to signature is a further 28 days (median; p25 15, p75 43).

## Does the agent know which drafts are right?
Partly. Rows where most similar homes agree are hits twice as often (56% against 33%, 60 held-out rows). That is why the inbox shows "N of 20 drafts need no change" and a one-line reason on every row that needs review, not a confidence score. Never claim that confidence predicts a match.

## Why is "all four right" so low for every engine?
[UNCONFIRMED: Xander to approve; final digits at 08:00] The inputs in the export carry about 18 to 20% of whole designs. Wallbox alone caps everyone at about 75%: a quarter of homes with no EV on record still got a wallbox, and nothing in the inputs predicts which. Our rules sit within noise of the black box, with every rule on screen.

## Reonic already scores leads. What does yours add?
Reonic scores each lead 0 to 100 on project readiness, property quality, customer profile, solar potential, customer sentiment and budget alignment (docs.reonic.com, lead scoring). Ours adds the designed system and its economics before any visit, estimated from the address. Offer values are estimates from the engine's stated cost assumptions, shown in the Rules block, not quotes.

## Would the verdict turn away real customers?
We replayed it on the 258 held-out signed sales: 82% Priority, 17% Call first, 1% Decline. Every one of those homes was sold, so each Decline is a mistake: 2 of 258, both homes where our design proposes no PV (planners sold one 2.7 kWp, the other already had solar). No design paid back in over 20 years (median 10.8, highest 16.8). Call first fires almost only where yearly use was never recorded, the 4,500 kWh default, on 46 of 258. The limit is that the pack holds signed sales only, so it shows the rule is not trigger-happy and cannot show that it catches bad leads; the roof and address checks could not be replayed, as the pack has no addresses. (engine/lab/qualification_backtest.md) [UNCONFIRMED: wording]

## Are heat pumps oversized today?
Fraunhofer ISE's "WP-QS im Bestand" (Nov 2025) measured 77 heat pumps in existing homes and found most oversized; real load is about 80 to 85% of the DIN norm load (Hochschule Ansbach 2023). Source: https://www.cleanthinking.de/?p=1074907. Marquee sizes the heat pump from the building itself: its envelope at the design temperature, estimated from the address, with the heat loss shown by element. The planner confirms on site.

## Does any homeowner funnel show a design before asking for contact details?
Across Enpal, 1KOMMA5° and Zolar we found none: Enpal asks 8 questions, none about electricity use, then hands over to a sales call. The assistant gives the homeowner a first design within three minutes, before anyone asks for a phone number.

## How is this different from PV*SOL, Autarc, Aurora or OpenSolar?
Autarc and PV*SOL simulate whatever the planner configures; Aurora and OpenSolar size to a target the user types. They simulate your choice. Marquee makes the choice, says why, and is measured on 633 held-out homes it never saw: the new-system jobs in the sealed half of 1,570 signed designs with parts (1,619 projects in the pack; engine/lab/reports/final_test_v2.md). Reonic's own AI chat sizes PV, storage and heat pump when the planner asks, from the installer's catalogue and past projects; Marquee proposes the complete design unprompted, explains each rule, and reports how often it matches the experts on homes it never saw. We found no other tool that publishes that match score.

## Why does the engine say 1,256 projects and the deck 1,570?
1,570 is every signed design with parts in the pack (1,619 projects, less 26 with no parts and 23 outliers); the lab sealed half of them away and scores on the 633 new-system jobs in that half. 1,256 is the set the live engine reports it trained on, which is built differently from the lab's sealed split. The scoreboard always quotes the lab's sealed numbers. 26 of 1,619 projects have no parts; a further 312 are add-ons with no new PV; both are outside the new-system scoreboard.
