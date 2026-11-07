# Questions for the Reonic experts on site

Ask in this order. Write the answer under each question with the expert's name and time. Answers feed `engine/` (via Xander) and the deck.

## Data (blocks the engine)
1. Installer `2a8ba8e2` has almost no `Module` rows. What is the reliable way to get PV kWp for its projects: mounting area, inverter kW, or package names? Is there a field we are missing?
2. About a third of projects have no parts. Are these lost deals, offers never sent, or projects planned outside Reonic? Is it right to drop them?
3. Is each project's design the offer that was sent, or the system actually installed? If several offer variants exist, which one is the expert design?
4. `energy_demand_wh`: is this household demand only, or does it already include an existing heat pump or EV?
5. Battery sizes in `component_name`: gross or usable kWh?
6. Heat pump rows: is the kW thermal output at a standard point (for example A2/W35), or the electrical input?

## How planners decide (feeds the model and the explanation)
7. What does a planner look at first: annual demand, roof, budget, or the homeowner's wish list?
8. When does a planner leave out the battery? Is there a demand or budget threshold they use?
9. When is a heat pump offered: only if the homeowner asks, or whenever the heating is gas or oil?
10. Do installers push standard packages (for example 10 kWp + 10 kWh) and adjust from there?
11. Why do the two installers in the data size differently? Different product ranges, region, or sales style?
12. Wallbox: always 11 kW when there is an EV, or do some get 22 kW?

## Proof and value (feeds the scoreboard and the deck)
13. What tolerance would a planner call "the same design": PV within 1 kWp? Battery within one product size?
14. How long does a planner spend on one design today, and how many offers per day?
15. What share of offers is signed, and does a faster offer win more often?
16. Which mistake hurts installers more: an undersized or an oversized system?
