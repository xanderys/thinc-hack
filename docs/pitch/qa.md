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

**What does the hero earn over 20 years?** Saving €1,430 a year, break-even in year 10 (simple payback 10.4 years), IRR 8.1%, €16,867 after 20 years with the €3,150 battery replacement in year 15 and the €2,100 residual credit in year 20 counted, NPV €8,320 on the same basis. Market-rate estimate from a rate card, not the installer's prices.

**Is the battery oversized?** By HTW Berlin's guide (at most 1.5 kWh per 1,000 kWh of use) the hero would take 7.5 kWh; the design has 10 kWh (EcoFlow), Installer A's package above 4,100 kWh. The rule follows what the installer sold, and the planner can pick the 5 kWh pack.

**How many modules fit the hero's roof?** 40 modules, 18.52 kWp at 463 W; the design uses 23 (10.65 kWp), and the Most independence variant uses the full roof.

**What does the Check page replay show?** Drawn from unseen homes with no match-first order: 3 of 20 match the expert on all four decisions at once, 15%, in line with the sealed 18.6% on 633; by part, panels sit within tolerance on 41% and the battery on 50%. All four at once is the strict test; the sealed figure is the one to quote.

**How big is the hero's heat load?** Upper bound from the building envelope, 17.2 kW; sized from the bill, 8.7 kW. The envelope figure is 39,000 kWh a year on 188 m² heated over two storeys, 92 W/m², inside the 60 to 99 W/m² tables for a 1984 to 1994 home. Heat-loss kW stays off the slides.

**What is the hero's design?** 23 Sunpro 463 W modules, 10.65 kWp, a Sigenergy 10 kW inverter (DC/AC 1.07), an EcoFlow 10 kWh battery, no heat pump, no wallbox; 9,858 kWh a year, 76.5% autarky, €14,887 estimate. Sizes snap to the SKU catalogue; the rules decide the size band, the catalogue the part.

**Where is the AI?** No language model sizes anything. The engine is readable rules fitted on the data plus hourly physics. Claude only reads a pasted enquiry into facts in the web layer, and ElevenLabs carries Rina's voice.

**Why does the Check page say 17.1% on 258 homes?** That was the earlier board population. The Check page now shows the sealed figure, 18.6% on 633, and nothing else.

**Would the verdict turn away real customers?** Replayed on the 126 held-out signed sales: 80% Priority, 18% Call first, 2% Decline, the verifier's recorded result, shown on the Check page. Every one was sold, so each Decline is a miss: 2 of 126, both homes where the rules propose no panels. Call first fires almost only where the use was never recorded. The pack holds signed sales only, so this shows the rule is not trigger-happy; it cannot show that it catches bad leads.

**Does anyone feed installed-system data back into design?** We found no public product that does. 1KOMMA5° Heartbeat connects tens of thousands of systems to trade power, not to size new ones (press release, 14 Nov 2025). Reonic holds both the offer and the installed system, so it can close that loop.

**How is this different from PV*SOL, Autarc, Aurora or OpenSolar?** They simulate or size what the planner configures. Marquee makes the choice, says why, and reports its match rate on held-out homes. We found no other tool that publishes that score.

**What would you do with another month?** Rules per installer across all of Reonic's installers, the computed next question in Reonic's intake, and installed-system meter data back into the rule set.

## Shared buildings: legal basis

Statutory facts behind the shared-building view (`web/components/systems/SharedBuilding.tsx`). They are not engine outputs and the engine does not check them. Statute text read on gesetze-im-internet.de on 8 Nov 2026; Marquee gives no legal advice.

1. **Roof PV needs the owners' decision.** [§ 20 Abs. 1 WEG](https://www.gesetze-im-internet.de/woeigg/__20.html): measures beyond proper maintenance of the common property ("bauliche Veränderungen") "können beschlossen" by the owners. The decision is by majority of votes cast, [§ 25 Abs. 1 WEG](https://www.gesetze-im-internet.de/woeigg/__25.html). Parts of the building needed for its stability or safety are never individual property, [§ 5 Abs. 2 WEG](https://www.gesetze-im-internet.de/woeigg/__5.html). Supported.
2. **Building-wide supply between flats.** [§ 42b EnWG](https://www.gesetze-im-internet.de/enwg_2005/__42b.html), "Gemeinschaftliche Gebäudeversorgung": a final consumer may use power from a "Gebäudestromanlage" in the same building without passing through the grid, under a "Gebäudestromnutzungsvertrag" (Abs. 1, 2) with 15-minute metering and a split key (Abs. 1 Nr. 3, Abs. 5); the operator need not supply everything, so top-up power is bought elsewhere (Abs. 3). Introduced by Solarpaket I in May 2024 (law-firm summaries; the statute page carries no history). Supported.
3. **Balcony systems up to 800 W.** [§ 8 Abs. 5a EEG](https://www.gesetze-im-internet.de/eeg_2014/__8.html): one or more "Steckersolargeräte" with up to 2 kW installed and up to 800 VA inverter output in total, behind a consumer's connection point, may be connected, and the grid operator may not demand extra notices. Registration in the Marktstammdatenregister remains, in a reduced form with the same 2,000 W and 800 W limits: [Bundesnetzagentur press release, 28 Mar 2024](https://www.bundesnetzagentur.de/SharedDocs/Pressemitteilungen/DE/2024/20240328_MaStR_Reg.html) and [MaStR registration help](https://www.marktstammdatenregister.de/MaStRHilfe/subpages/regCheckSolar.html). The limit is 800 VA of inverter output, not 800 W of panels (up to 2 kW). Supported. The older 600 VA figure came from a technical rule, not the statute, and is not used here.
4. **Right to a charging point.** [§ 20 Abs. 2 Nr. 2 WEG](https://www.gesetze-im-internet.de/woeigg/__20.html): every owner may demand reasonable structural changes that serve "dem Laden elektrisch betriebener Fahrzeuge"; the owners then decide how, in proper administration, not whether. The reform is the WEMoG of 2020 ([Bundestag](https://www.bundestag.de/webarchiv/textarchiv/2020/kw38-de-wohnungseigentumsmodernisierungsgesetz-791760)); tenants have the parallel § 554 BGB. Supported, with one correction: the statute does not mention a parking space. The UI wording "at your own parking space" is our reading, so it should say "a charging point" and not promise a space. Balcony solar was added to the same list as Nr. 5 in 2024 (in force 17 Oct 2024 per secondary sources only, not confirmed in the Bundesgesetzblatt here).

Not confirmed from an official source and therefore left out: the exact in-force dates of the WEMoG (1 Dec 2020) and Solarpaket I (16 May 2024).
