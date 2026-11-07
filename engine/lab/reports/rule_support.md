# Rule support, rules-4-readout (06c6052)

Every one of the 654 fit-half new-system homes is assigned its rule under the shipped rules4.json. In-sample share: the shipped rules on their own homes, within tolerance for that component. Out-of-fold share: the same homes' 5-fold prediction (fold seed 42), where the trees differ per fold.

| Component | Rule id | Homes | In-sample within tolerance | Out-of-fold within tolerance |
|---|---|---|---|---|
| battery | 2a8ba8e2:battery:PV over 7.2 kWp, use incl. EV up to 12,600 kWh | 361 | 44.9% | 44.9% |
| battery | 2a8ba8e2:battery:PV up to 7.2 kWp | 111 | 56.8% | 56.8% |
| battery | 23c108b7:battery:use incl. EV 4,550 to 8,950 kWh, PV over 9.45 kWp | 50 | 70.0% | 64.0% |
| battery | 23c108b7:battery:use incl. EV up to 4,550 kWh, PV over 9.45 kWp | 44 | 75.0% | 75.0% |
| battery | 23c108b7:battery:use incl. EV up to 8,950 kWh, PV 6.97 to 9.45 kWp | 35 | 54.3% | 54.3% |
| battery | 2a8ba8e2:battery:PV over 7.2 kWp, use incl. EV over 12,600 kWh | 17 | 35.3% | 5.9% |
| battery | 23c108b7:battery:use incl. EV over 8,950 kWh | 15 | 40.0% | 6.7% |
| battery | 23c108b7:battery:use incl. EV up to 8,950 kWh, PV up to 6.97 kWp | 15 | 60.0% | 60.0% |
| battery | None | 6 | 16.7% | 16.7% |
| heatpump | heatpump:none | 654 | 99.2% | 99.2% |
| pv | 2a8ba8e2:pv:use incl. EV 3,550 to 9,100 kWh | 315 | 41.9% | 40.6% |
| pv | 2a8ba8e2:pv:use incl. EV up to 3,550 kWh, not heating with a heat pump | 111 | 45.9% | 44.1% |
| pv | 23c108b7:pv:use incl. EV 3,750 to 8,950 kWh | 97 | 59.8% | 49.5% |
| pv | 23c108b7:pv:use incl. EV 2,900 to 3,750 kWh | 36 | 38.9% | 33.3% |
| pv | 2a8ba8e2:pv:use incl. EV 9,100 to 12,600 kWh | 22 | 45.5% | 22.7% |
| pv | 2a8ba8e2:pv:use incl. EV up to 3,550 kWh, heating with a heat pump | 22 | 54.5% | 31.8% |
| pv | 2a8ba8e2:pv:use incl. EV over 12,600 kWh | 17 | 47.1% | 17.6% |
| pv | 23c108b7:pv:use incl. EV over 8,950 kWh | 15 | 53.3% | 26.7% |
| pv | 23c108b7:pv:use incl. EV up to 2,900 kWh | 15 | 40.0% | 26.7% |
| pv | None | 4 | 75.0% | 75.0% |
| wallbox | wallbox:none | 619 | 75.6% | 75.6% |
| wallbox | wallbox:EV or asked | 35 | 60.0% | 60.0% |
