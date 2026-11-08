# Submission

Form: https://thinc-hack.lovable.app

**Team name:** Marquee

**Team members:** Zi Yuan, Xander, Jamon

**Case:** Reonic

**Repository:** https://github.com/xanderys/thinc-hack (public)

**Planner app:** https://marquee-reonic.vercel.app

**Homeowner app:** https://marquee-home.vercel.app

**Deck:** deck/marquee-reonic.pdf

**Demo video:** (link from Zi Yuan; fallback v7)

**One sentence:** Marquee drafts a home's panels, battery, wallbox and heat pump with the rules it used, reports how often the experts agreed on homes it never saw, and hands the completed design to the homeowner to sign.

**Description:** Marquee speeds up the installer's pipeline from enquiry to signed deal. A lead arrives by form, pasted email or a call with the installer's voice agent, and lands on the planner's board with a verdict (Priority, Call first, Decline) and the reason. The planner opens the real house, from Bavarian LoD2 data with the aerial photo and shade per panel, and sees four decisions in a chain plus the offer, each with its rule. One changed fact, an electric car next year, runs the chain again and adds the wallbox. Complete sends exactly the chosen variant to the homeowner's page, on WhatsApp or as a link, where they sign or decline. Planners drive it by asking: an agentic copilot proposes changes with before and after figures to apply or undo, autopilot works the whole inbox with WhatsApp asks, and on the call each answer is read by Claude into a typed fact that redraws the design live. The rules are read out of Reonic's 1,619 projects (1,570 usable, split in half before fitting, the second half sealed) and printed on screen, so a planner can check and overrule every size. On 633 sealed held-out homes, all four decisions match the expert within tolerance on 18.6% against 6.8% for the textbook rule (PV alone 40.9% against 19.4%). Costs are 2026 German averages, not the installer's prices, and the demo installer Isarwerk Solar is fictional.

**For whom:** Planners and sales staff at installers on Reonic, and their homeowners.

**What is unique:** An auditable first draft. The rules are printed on screen, so a planner can check and overrule every size, and the score on homes the rules never saw is published.

**How it was built:** A Python engine of readable rules fitted per installer, with hourly physics (pvlib, Munich's real 2025 weather and day-ahead prices) for the economics and a sealed held-out evaluation. No language model sizes anything; Claude reads a pasted enquiry into facts in the web layer, and ElevenLabs carries the voice agent.

**Tech stack:** Python, pandas, FastAPI, pvlib (engine); Next.js, TypeScript, three.js, Anthropic SDK, ElevenLabs (web); Bavarian LoD2 and census open data; Vercel.
