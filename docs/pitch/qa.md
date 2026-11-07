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
