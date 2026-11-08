# Jury Q&A

Numbers match deck/slides.md and engine/lab/reports/final_test.md. Never say: eight days saved, proof on every number, heat pump 99.5%, rules beat ML, ceiling, or that chat sizing, voice intake or lead scoring is new.

## The ten hardest

1. **Reonic already has AI planning. Why does it need this?**
   Reonic's chat sizes from the catalogue when the planner asks, and the planner picks by hand. Marquee proposes the whole system unprompted, shows the rule behind each size, publishes how often it matches the experts on homes it never saw, and hands the chosen design to the homeowner to sign. Chat, voice intake and lead scoring are not our claim; the readable rules, the held-out score and the computed next question are.

2. **How often do you actually reproduce the expert?**
   All four decisions within tolerance on 18.6% of 633 held-out new-system homes, against 6.8% for the textbook rule. Tolerance: panels within 1 kWp or 15%, battery within 2 kWh, heat pump and wallbox decisions exact. Panels alone 41%, battery 50%.

3. **Do transparent rules beat machine learning?**
   No claim. On the 126 homes both were scored on, the rules reach 23.0% and the black box 19.0%, paired p = 0.332, a tie. Readability is the reason to prefer the rules: a planner can read and overrule every one.

4. **Why is "all four right" so low for every engine?**
   The wallbox alone caps everyone near 79%: a quarter of homes with no car on record still got one, and nothing in the record predicts which. Roof size and budget are not recorded, and 17 to 19% of homes carry the 4,500 kWh default in place of a bill.

5. **Is heat pump accuracy meaningful?**
   No, and we do not claim it. The pack holds 13 heat pumps in 1,619 projects, so an always-none rule scores the same. Our rule fires only when asked or for a gas or oil boiler 20 years or older.

6. **Is your design better than the expert's?**
   Only under our simulator's assumptions. Where the designs differ, 514 of the 633, ours scores higher on modelled 20-year value on 327 homes, the expert's on 180, median gain about 430 EUR. That is modelled with the same hourly simulation and the same market-rate price card for both, not measured installation performance.

7. **Is the physics validated?**
   An hourly simulation with pvlib on Munich's real 2025 weather and day-ahead prices, the same for every design. The hero's whole chain (investment, yield, autarky, saving, break-even, NPV) reproduces from the code end to end, checked on 8 Nov. No independent validation yet; a pilot would compare meter data from installed systems.

8. **How much time or money does an installer save?**
   Not measured. The pack has no planner time or price data, so we show the steps the draft removes, not hours or euros. A pilot would measure planner handling time per offer and the share of drafts that survive without edits.

9. **What happens with incomplete or unsuitable data?**
   The board says so instead of guessing: Call first when the roof is not measured or the use is the default, Decline when the roof fits under 3 kWp or nothing pays back in 20 years. Facts the engine estimated from the address are labelled estimates, apart from stated ones.

10. **Can the homeowner trust that this is the design the planner completed?**
    Complete stores the chosen variant and its design, and the homeowner page renders that record only; the send sheet (WhatsApp or a copied link) carries that one record. The red team found a mismatch early on 8 Nov; the fix is in planner production and the acceptance check is: pick Lowest upfront, press Complete, reload both pages, same components and price.

## More

**How do you know it is not overfitting?** Half the data was sealed with a fixed seed before any rule was fitted. Every score on the deck is from that half. The rules were fitted on the other half (654 new-system homes) with 5-fold cross-validation.

**Where do the prices come from?** Public German market rates in a rate card the installer replaces with its own catalogue on day one; the dataset carries no prices, so we never claim price accuracy. Every € in the app sits behind an "i" that reads "Market estimate, not the installer's price list", with the unit rates and the arithmetic.

**What does the hero earn over 20 years?** Break-even in year 10, IRR 8.19%, €16,796 after 20 years, with the €3,150 battery replacement at year 15 and the €2,100 residual counted. Market-rate estimate, not the installer's prices.

**Is the battery oversized?** By HTW Berlin's guide (at most 1.5 kWh per 1,000 kWh of use) the hero would take 7.5 kWh; the design has 10 kWh, Installer A's package above 4,100 kWh. The rule follows what the installer sold, and the planner can pick the 5 kWh pack.

**How many modules fit the hero's roof?** 40 modules, 18 kWp; the design uses 23.

**What does the Check page replay show?** Drawn from unseen homes with no match-first order: 3 of 20 match the expert on all four decisions at once, 15%, in line with the sealed 18.6% on 633; by part, panels sit within tolerance on 41% and the battery on 50%. All four at once is the strict test; the sealed figure is the one to quote.

Never quote a heat-loss kW figure for the hero; the envelope rerun is pending.

**Where is the AI?** No language model sizes anything. The engine is readable rules fitted on the data plus hourly physics. Claude only reads a pasted enquiry into facts in the web layer, and ElevenLabs carries Rina's voice.

**Why does the Check page say 17.1% on 258 homes?** That was the earlier board population. The Check page now shows the sealed figure, 18.6% on 633, and nothing else.

**Would the verdict turn away real customers?** Replayed on the 126 held-out signed sales: 80% Priority, 18% Call first, 2% Decline. Every one was sold, so each Decline is a miss: 2 of 126, both homes where the rules propose no panels. Call first fires almost only where the use was never recorded. The pack holds signed sales only, so this shows the rule is not trigger-happy; it cannot show that it catches bad leads.

**Does anyone feed installed-system data back into design?** We found no public product that does. 1KOMMA5° Heartbeat connects tens of thousands of systems to trade power, not to size new ones (press release, 14 Nov 2025). Reonic holds both the offer and the installed system, so it can close that loop.

**How is this different from PV*SOL, Autarc, Aurora or OpenSolar?** They simulate or size what the planner configures. Marquee makes the choice, says why, and reports its match rate on held-out homes. We found no other tool that publishes that score.

**What would you do with another month?** Rules per installer across all of Reonic's installers, the computed next question in Reonic's intake, and installed-system meter data back into the rule set.
