# Submission

**One sentence:** Marquee drafts a home's panels, battery, wallbox and heat pump with the rules it used, reports how often the experts agreed on homes it never saw, and hands the approved design to the homeowner to sign.

**What it does:** A lead arrives by form, pasted email or a call with the installer's voice agent, and lands on the planner's board with a verdict (Priority, Call first, Decline) and the reason. The planner opens the real house, from Bavarian LoD2 data with the aerial photo and shade per panel, and sees four decisions in a chain plus the offer, each with its rule. One changed fact, an electric car next year, runs the chain again and adds the wallbox. Approve releases exactly the chosen variant to the homeowner's page, where they sign or decline.

**For whom:** Planners and sales staff at installers on Reonic, and their homeowners.

**What is unique:** An auditable first draft. The rules are read out of 1,570 signed designs per installer and printed on screen, so a planner can check and overrule every size. The score is published: all four decisions within tolerance on 18.6% of 633 sealed held-out homes, against 6.8% for the textbook rule, and a tie with a black box model on the homes both were scored on.

**How it was built:** A Python engine of readable rules fitted per installer, with hourly physics (pvlib, Munich's real 2025 weather and day-ahead prices) for the economics and a sealed held-out evaluation. No language model sizes anything; Claude reads a pasted enquiry into facts in the web layer, and ElevenLabs carries the voice agent.

**Tech stack:** Python, pandas, FastAPI, pvlib (engine); Next.js, TypeScript, three.js, Anthropic SDK, ElevenLabs (web); Bavarian LoD2 and census open data; Vercel.

**Links:** demo https://marquee-reonic.vercel.app, code https://github.com/xanderys/thinc-hack
