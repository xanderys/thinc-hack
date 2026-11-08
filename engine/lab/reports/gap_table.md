# Textbook against practice

Fit half, 654 new-system jobs, by installer, aggregates only. Textbook = the engine's rule of thumb (1.3 kWp per MWh + 2.5 kWp with an EV, battery at the installer's median, 11 kW wallbox with an EV, no heat pump) and DC/AC 1.2. Planners' median and IQR (25th to 75th percentile) are over the installer's own jobs. The Reonic textbook rows (rules5.textbook, no corrections) are ratios of the planners' size to the textbook size.

| Rule | Installer | n | Textbook | Planners' median | IQR |
|---|---|---|---|---|---|
| PV, homes without an EV: kWp per MWh of use | 23c108b7 | 151 | 1.30 | 2.16 | 1.60 to 3.00 |
| PV, homes with an EV: kWp above 1.3 per MWh | 23c108b7 | 12 | 2.50 | 6.19 | 4.68 to 6.77 |
| Battery: share of homes with one | 23c108b7 | 163 | yes | 99% | n/a |
| Battery size, kWh, where fitted (textbook: installer median, median size) | 23c108b7 | 161 | 9.0 | 9.0 | 9.0 to 10.0 |
| Wallbox: share of EV homes with one | 23c108b7 | 12 | 100% | 67% | n/a |
| Wallbox size, kW, where fitted | 23c108b7 | 8 | 11.0 | 11.0 | 11.0 to 13.8 |
| Heat pump: share of homes with one | 23c108b7 | 163 | 0% | 0.0% | n/a |
| DC/AC ratio (PV kWp over inverter kW) | 23c108b7 | 16 | 1.20 | 1.19 | 0.90 to 1.35 |
| PV, homes without an EV: kWp per MWh of use | 2a8ba8e2 | 465 | 1.30 | 1.90 | 1.40 to 2.55 |
| PV, homes with an EV: kWp above 1.3 per MWh | 2a8ba8e2 | 23 | 2.50 | 4.95 | 3.30 to 8.54 |
| Battery: share of homes with one | 2a8ba8e2 | 491 | yes | 94% | n/a |
| Battery size, kWh, where fitted (textbook: installer median, median size) | 2a8ba8e2 | 460 | 10.0 | 10.0 | 7.0 to 10.0 |
| Wallbox: share of EV homes with one | 2a8ba8e2 | 23 | 100% | 57% | n/a |
| Wallbox size, kW, where fitted | 2a8ba8e2 | 13 | 11.0 | 11.0 | 11.0 to 11.0 |
| Heat pump: share of homes with one | 2a8ba8e2 | 491 | 0% | 1.0% | n/a |
| DC/AC ratio (PV kWp over inverter kW) | 2a8ba8e2 | 0 | 1.20 | n/a | n/a to n/a |
| Reonic textbook PV: planners' kWp over the textbook kWp (1.0 per MWh) | 23c108b7 | 163 | 1.00 | 2.18 | 1.57 to 2.87 |
| Reonic textbook battery: planners' kWh over the textbook kWh (1.25 per MWh, clipped 0.2 to 0.6 per daily kWh) | 23c108b7 | 157 | 1.00 | 1.50 | 1.20 to 1.80 |
| Reonic textbook battery: share of homes offered one | 23c108b7 | 163 | 98% | 99% | n/a |
| Reonic textbook wallbox: share of homes offered one | 23c108b7 | 163 | 7.4% | 27.6% | n/a |
| Reonic textbook heat pump: share of homes offered one | 23c108b7 | 163 | 0.0% | 0.0% | n/a |
| Reonic textbook PV: planners' kWp over the textbook kWp (1.0 per MWh) | 2a8ba8e2 | 487 | 1.00 | 1.88 | 1.38 to 2.50 |
| Reonic textbook battery: planners' kWh over the textbook kWh (1.25 per MWh, clipped 0.2 to 0.6 per daily kWh) | 2a8ba8e2 | 458 | 1.00 | 1.43 | 1.00 to 2.00 |
| Reonic textbook battery: share of homes offered one | 2a8ba8e2 | 491 | 99% | 94% | n/a |
| Reonic textbook wallbox: share of homes offered one | 2a8ba8e2 | 491 | 4.7% | 25.9% | n/a |
| Reonic textbook heat pump: share of homes offered one | 2a8ba8e2 | 491 | 0.0% | 1.0% | n/a |
