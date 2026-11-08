# Why an installer still visits before an offer, and what Marquee does about each

Removes: the visit is not needed for this reason. Reduces: Marquee answers enough to make the offer, and the visit only confirms. Leaves: Marquee does not touch it today.

The WhatsApp copilot asks for facts in text (yearly use, heating type and use, boiler age, electric car, existing solar, household size). It does not ask for photos today, so no row below claims a photo.

| Reason for the visit | What Marquee does | Effect |
|---|---|---|
| Roof size, faces and pitch | LoD2 roof model gives every plane's area, tilt and orientation from the Bavarian survey | Removes for the offer |
| Shading from trees, dormers and neighbours | DOM20 surface model ray-cast per panel, shown as a heatmap on the model | Removes for the offer |
| Roof covering, age and condition | Aerial and Bavarian imagery show the covering; age and damage are not visible | Leaves: still needs a visit |
| Module layout and spacing | On-model placement with slots on each roof plane, edited by the planner | Reduces |
| Shared roof or flats | Zensus dwellings class and building shape flag a shared roof; the board says Call first | Reduces: one call, not a visit |
| Ownership and consent | Not checked | Leaves: asked on the call |
| Electricity use | Bill or the copilot's question fills it; the board flags the default | Removes |
| Heating type, use and boiler age | The copilot asks; the rules decide whether a heat pump is drafted | Removes for the draft |
| Heat load for the heat pump | Envelope heat-loss model gives an upper bound beside the size from the bill | Reduces: the visit confirms radiators and flow temperature |
| Existing radiators and flow temperature | Not modelled | Leaves: still needs a visit |
| Heat pump outdoor unit position and noise distance | The model places a unit beside the house; distance to the neighbour is not checked | Leaves: still needs a visit |
| Meter cabinet and grid connection | Not modelled | Leaves: still needs a visit or a photo from the homeowner |
| Inverter and battery location | Placed indoors on the model as a default | Leaves: still needs a visit |
| Cable runs | Not modelled | Leaves: still needs a visit |
| Wallbox location | Not placed | Leaves: still needs a visit or a photo |
| Scaffold and access | Street and garden visible on the aerial view; not assessed | Leaves: still needs a visit |
| Structural load of the roof | Not modelled | Leaves: still needs a visit |
| Permits and grid operator notice | Not handled | Leaves: office work, not a visit |

What this means: the roof, the shade, the use and the heating answer come from data before anyone drives out, so the offer can go first and the visit becomes a check of the cabinet, the cables, the radiators and the unit positions.

LiDAR or RoomPlan for the visit itself: no build today. It would measure rooms and the meter cabinet on the installer's phone, but it needs a native iOS app, the visit still happens, and nothing in our pipeline reads a room scan yet.
