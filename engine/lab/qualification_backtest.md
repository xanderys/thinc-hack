# Visit verdict backtest

Source: `engine/lab/qualification_backtest.py` (engine-lab). Aggregates only.

## What was replayed

- **Rule.** `origin/qualify` does not exist and `docs/qualification.md` is not on any branch yet. The only written source is `docs/briefs/qualify.md` on main, which gives the same thresholds as the task: Call first when annual use is the 4,500 kWh default, heating type unknown on a heating bill, or no address; Decline when payback is beyond 20 years, roof under about 3 kWp or north-only, or the homeowner declined; Visit otherwise. Precedence used: Decline before Call first (the brief does not say otherwise).
- **Engine.** Production is `RECOMMENDER=readout` (rules-4-readout, as `/health` on the mini reports and `~/.config/marquee/engine.env` sets; the code default is `ml`, not used). The engine was fitted as in production (`Engine(df).fit()` at origin/engine b7e0f9f), then `Engine.predict(inputs)` was called per home, the same call `/api/design` makes, with the pack's own inputs and no address, so no roof lookup. Payback is `economics.payback_years` from that design's hourly simulation.
- **Sets.** The 258 held-out new-system board, and the clean 126 (258 board and test half, `engine/lab/split`). The board is held out of the engine's training, so no home is scored by a model that saw it.
- **Skipped clauses.** Roof capacity and north-only (the roof is not in the pack), homeowner declined (not in the pack). Declines here can only come from payback.
- **Payback None.** A design with no PV has no payback. I counted that as Decline (no viable system). Under a strict "over 20 years" reading, nobody is declined.

## Shares, without the address clause (the lead version)

| Set | n | Visit | Call first | Decline |
|---|---|---|---|---|
| 258 board | 258 | 211 (81.8%) | 45 (17.4%) | 2 (0.8%) |
| clean 126 | 126 | 101 (80.2%) | 23 (18.3%) | 2 (1.6%) |

## Shares, with the address clause

The pack has no address, so every home fires it.

| Set | n | Visit | Call first | Decline |
|---|---|---|---|---|
| 258 board | 258 | 0 (0.0%) | 256 (99.2%) | 2 (0.8%) |
| clean 126 | 126 | 0 (0.0%) | 124 (98.4%) | 2 (1.6%) |

## False declines

Every project is a signed sale, so every Decline is a false decline.

| Set | Declined | False-decline rate | Median payback | Median PV sold | With battery |
|---|---|---|---|---|---|
| 258 board | 2 | 0.8% | none (no PV designed) | 1.4 kWp | 0 of 2 |
| clean 126 | 2 | 1.6% | none (no PV designed) | 1.4 kWp | 0 of 2 |

The two declined homes are the same on both sets, and in both our design proposes no PV, so there is no payback to report. Planners sold one of them 2.7 kWp of PV and the other no new PV (an existing-solar home). Over the whole 258, no design has a payback beyond 20 years: payback runs p10 8.4, median 10.8, p90 12.9, maximum 16.8 years. The payback clause on its own would decline nobody.

## Call first, per fact

Firing on all homes in the set, before precedence:

| Set | n | Default 4,500 kWh | Heating unknown with a bill | No address |
|---|---|---|---|---|
| 258 board | 258 | 46 (17.8%) | 0 (0.0%) | 258 (100%) |
| clean 126 | 126 | 24 (19.0%) | 0 (0.0%) | 126 (100%) |

Overlaps (address excluded): 46 homes with demand only, 0 heating only, 0 both on the 258; 24, 0, 0 on the clean 126. Of the 46 default-demand homes, 1 is also declined, leaving 45 Call first (23 of 24 on the clean 126). The heating clause never fires because in this pack no home with type Unknown has a heating bill.

## For the deck and Q&A

On the 258 held-out homes the rule sends 82 per cent to a visit, 17 per cent to a call first and 1 per cent to decline. Every one of these homes was in fact sold, and the rule wrongly turned away only 2 of them, both homes where our engine designs no PV at all; the highest payback our design produces anywhere is 16.8 years. That is a weak test of the Decline clause, because a pack of signed sales holds almost no leads worth declining: it shows the rule is not trigger-happy and says nothing about whether it catches bad leads. The Call first clause fires almost entirely on the 4,500 kWh default (17.8 per cent), which is a real data gap, but the pack cannot show whether a call would have changed the design. The address clause fires for everyone only because the pack has no addresses, so it is not a finding. The roof, north-only and homeowner-declined clauses were not testable, and our payback figures are estimates from our own design, not the installer's quote.
