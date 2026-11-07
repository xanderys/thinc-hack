# Jury Q&A

Draft v1. Every number here must match the final deck.

1. **38.9% sounds low. Why is that good?**
   Two planners agree on identical homes only 39 to 43% of the time, so that is the ceiling the data allows. We reach it; the textbook rule reaches 16.8%.

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
