# Submission

**One sentence:** Marquee turns a few facts about a home into the PV, battery, heat pump and wallbox design an experienced planner would draw, with the reasons, and proves it on homes it has never seen.

**What it does:** A planner enters a home and gets a complete design, or "none" for any component, with a one-line reason and similar past homes as evidence. The planner refines it with a slider or a sentence ("the family buys an EV next year") and the design adapts. A check view compares our design with the expert's on held-out projects.

**For whom:** Planners at installation companies; a homeowner view is the next step on the same engine.

**What is unique:** We measured how often planners agree with each other on identical homes (39 to 43%) and match that level: 38.9% of PV designs within 1 kWp or 15% of the expert, against 16.8% for the textbook rule. The model learned the unwritten rules in the data: a PV floor plus slope, a battery with 95% of PV designs, wallboxes without a recorded EV.

**How it was built:** A chained statistical model (PV, then battery given PV, then heat pump, then wallbox) with gradient boosting and nearest neighbours, snapped to each installer's catalogue, with physics checks. No language model makes a sizing decision; Claude only turns a planner's sentence into input changes.

**Tech stack:** Python, pandas, scikit-learn, FastAPI (engine); Next.js, TypeScript, Anthropic SDK (web); Vercel.

**Links:** demo https://marquee-reonic.vercel.app, code [UNCONFIRMED: repo link and whether it is public].
