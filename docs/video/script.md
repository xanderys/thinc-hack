# Marquee product walkthrough, shot list (target 2:35, hard max 3:00)

Pure screen recording at 1920x1080. VO at about 2.3 words a second; spoken numbers ("ten point three five") run long, so each beat has slack. Every figure below was read off production on 8 Nov 2026, about 10:30 Munich. Re-read each figure on the take and change the line if the screen differs.

Wording rules (deck script plus docs/pitch/red-team-apply.md): never "eight days saved", "proof", "beats ML", "beats experts", heat pump 99.5%, "energy management included", or any hours or euros saved. Prices on screen are estimates and are said as such. Isarwerk Solar is our fictional demo installer.

Lead roles:
- **Hero, read only:** db67b84935, Katrin Huber, Katharinenstraße 5, 82008 Unterhaching. Pinned. Press nothing that writes (no Apply, no Approve, no variant pick).
- **Write beats (form, call, sentence, Approve, sign):** a fresh test lead made from `https://marquee-home.vercel.app/?test=1` (Electric car: No). Do not use 9dcedce634 for the sentence beat: it already has an electric car (15,000 km a year) and is already Approved, so the wallbox cannot appear.

## Beat 1, hook

| Time | On screen | Voiceover | Caption |
|---|---|---|---|
| 0:00 to 0:10 | `https://marquee-home.vercel.app`, empty form "Request your solar offer", Isarwerk Solar header. Cursor still, top right. | "From enquiry to signed offer takes days. A planner sizes panels, battery, wallbox and heat pump by hand, then writes the offer." | Enquiry to signed offer, by hand |

## Beat 2, homeowner form and Rina's call

| Time | On screen | Voiceover | Caption |
|---|---|---|---|
| 0:10 to 0:24 | `https://marquee-home.vercel.app/?test=1`. Type name and "Katharinenstraße 5, 82008 Unterhaching", tap People 4, Heating Gas, Electric car No, Bill 60 to 100, Roof faces East and west, Submit. About 1.4 s later the iOS banner "Rina, Isarwerk Solar" slides in; click the green Accept. Full-screen call, timer runs, "Rina is speaking". Keep 3 s of Rina's real audio under the VO. | "A homeowner taps through the installer's form. Rina, the installer's voice agent, calls back and asks what the design still needs." | Rina calls back |

UNVERIFIED on production: Submit and Accept write a lead and start an ElevenLabs call, so I checked only that the form, Submit button and call code are live. Confirm on the take that Rina asks a design question; if she does not, cut "and asks what the design still needs". Fallback if the call fails to connect: show the banner and Accept, cut before the error, VO unchanged up to "calls back".

## Beat 3, the board

| Time | On screen | Voiceover | Caption |
|---|---|---|---|
| 0:24 to 0:34 | `https://marquee-reonic.vercel.app`. Hard reload: the cards first sit under "Checking", then sort into Priority 1, Call first 1, Decline 2. Cursor rests on the Katrin Huber card (Priority, 10.35 kWp + 10 kWh + wallbox, €15,820, estimate), then on Sabine Wagner's line "One call first: the roof is not measured, ask for the address." | "The lead lands on the planner's board already sorted: Priority, Call first or Decline, each with the reason." | Sorted on arrival |

Note: a `?test=1` lead is left out of the board, so the board shows the pinned leads, not the one from Beat 2. That is fine on screen; do not say "her lead" here.

## Beat 4, the hero lead

| Time | On screen | Voiceover | Caption |
|---|---|---|---|
| 0:34 to 0:52 | Click the Katrin Huber card, lands on `https://marquee-reonic.vercel.app/h/db67b84935`. Wait for the 3D house (tag "Building model" settles). Cursor under the header line "Priority. Worth a visit: the roof fits 10.35 kWp and pays back in 10 years. Expected offer about €15,820." Then hover the west and east face labels on the roof, then the Shading row "0.6 %, 59 kWh a year loss"; drag the hour slider from 13 to 17 so the shade moves. | "Katrin Huber is Priority. The roof fits 10.35 kilowatt peak and pays back in ten years. This is her real house, built from Bavarian 3D data and the aerial photo, with shade worked out panel by panel: 0.6 percent." | Her real roof, no site visit |

## Beat 5, the chain

| Time | On screen | Voiceover | Caption |
|---|---|---|---|
| 0:52 to 1:14 | Same page. Systems chips under the view: Panels is selected ("10.35 kWp, 23 modules", "West face 25 deg 1.35 kWp, East face 25 deg 9 kWp", "Sized for today's use plus the car" under Why). Click Battery (10 kWh, "A spring weekday 17.8 kWh"), Wallbox (11 kW, "12,000 km a year is 2,160 kWh ... 4.7 kWh a night"), Heat pump ("No heat pump in this design. The boiler's age is not known."). The camera moves with each chip. | "Four decisions in a chain. Panels: 23 modules, 10.35 kilowatt peak, sized for her use plus the car. Battery: 10 kilowatt hours. Wallbox: 11 kilowatts, for 12,000 kilometres a year. Heat pump: none, because the boiler's age is not known. Each step has a Why." | Panels, battery, wallbox, heat pump |

## Beat 6, Proposed Design and variants

| Time | On screen | Voiceover | Caption |
|---|---|---|---|
| 1:14 to 1:26 | Click the Proposed Design card (10.35 kWp, 10 kWh, €15,820) to expand: Yield 9,580 kWh, Autarky 64 %, Investment €15,820, Break-even 10 years, power-flow diagram. Scroll inside the card to the variants: Planners' pick €15,820, Lowest upfront cost €5,120, Best payback €12,250, Most independence €24,150, all "estimate". Keep the cursor away from Approve (it sits under the card); press nothing. | "The Proposed Design adds it up: 15,820 euros, break-even in ten years, and the planners' pick next to cheaper and bigger alternatives." | Variants, all estimates |

Do not hold on the line "Energy management and smart meter: included with the battery" in the expanded card: red-team ruled it out and it is still live. Scroll past it. Do not voice "Payback 9.6 years" (the checks list says 9.6, the card says 10).

## Beat 7, change the kit

| Time | On screen | Voiceover | Caption |
|---|---|---|---|
| 1:26 to 1:46 | Fresh test lead from Beat 2, `https://marquee-reonic.vercel.app/h/<test id>`. Click the Wallbox chip, hold on its Why. Then open the kit size chooser on Battery and pick 5 kWh in place of 10 kWh. Hold on the Proposed Design pass at the bottom as its figures update (investment, autarky, break-even). | "The planner can change any part. Battery down from ten to five kilowatt hours, and the Proposed Design updates at once." Then read what moved, for example the new investment. | Change a part, the design follows |

Sentence bar removed from the product (Chief-of-Staff, 8 Nov); this replaces the sentence edit. NOT VERIFIED: the size chooser writes, so test lead only, never the hero. Say only the figures you see change.

## Beat 8, Approve

| Time | On screen | Voiceover | Caption |
|---|---|---|---|
| 1:46 to 1:50 | Same test lead. Expand Proposed Design, click Approve. Status chip top right changes from Draft. | "The planner approves." | Approved |

## Beat 9, the homeowner's proposal and signature

| Time | On screen | Voiceover | Caption |
|---|---|---|---|
| 1:50 to 2:04 | `https://marquee-home.vercel.app/start/proposal/<test id>`. "Isarwerk Solar, Approved: Planner's adjusted design, Your proposal". Scroll: roof view, Yield a year, Investment estimate "An estimate until the site visit", Break-even, Your system, Sign. Type the full name, draw a signature, tick "I accept this proposal", click Sign. Cut to `https://marquee-reonic.vercel.app` showing the card with its new status. | "The homeowner gets exactly that design: yield, an estimate until the site visit, and a place to sign. The signature comes back to the board." | Signed, back on the board |

NOT VERIFIED: signing writes, so I saw the Sign form on 9dcedce634 but did not press it. The board does show homeowner decisions (Markus Lindner: "Declined by the homeowner on 8 Nov"), but I did not see a signed card. If the signed state does not show on the board, cut the last sentence. The page footer "Demo acceptance, not a qualified e-signature." may stay in frame.

## Beat 10, the check

| Time | On screen | Voiceover | Caption |
|---|---|---|---|
| 2:04 to 2:22 | `https://marquee-reonic.vercel.app/check`. Hold on the blue card: "Whole design within tolerance on 633 sealed held-out signed homes, scored once. Marquee draft 18.6%. Textbook rule 6.8%." Then scroll slowly to "One held-out home, draft against the senior planner" (Solar 8.1 vs 6.75 kWp missed, Battery 5 vs 7 kWh within, heat pump and wallbox none, within). | "Then the check. We sealed 633 signed homes the rules never saw and scored them once. All four parts within tolerance at once: Marquee's draft 18.6 percent, the textbook rule 6.8." | 633 sealed homes, scored once |

## Beat 11, close

| Time | On screen | Voiceover | Caption |
|---|---|---|---|
| 2:22 to 2:35 | Cut back to `https://marquee-reonic.vercel.app/h/db67b84935`, 3D house with the Panels chip, slow orbit by drag or hold still. | "Every enquiry arrives with a first draft the planner can read, change and approve. Offers go out faster, and more of them get signed." | Marquee, for Reonic installers |

Runtime: 2:35 with all beats; about 300 words of VO.

## Capture checklist

Hold time is 1.5 times the VO for the beat, rounded up. Record every shot at 1920x1080, browser zoom 100%, no bookmarks bar, one tab.

| Shot | URL and lead | Starting state | Clicks in order | Hold |
|---|---|---|---|---|
| 1 Hook | `https://marquee-home.vercel.app`, no lead | Empty form, page scrolled to top | None | 15 s |
| 2 Form and call | `https://marquee-home.vercel.app/?test=1`, new test lead | Empty form, microphone allowed for the site, sound on | Name field, address field, 4, Gas, No (Electric car), 60 to 100, East and west, Submit, Accept on the banner; let Rina speak about 5 s; End call | 21 s from Submit (plus the typing) |
| 3 Board | `https://marquee-reonic.vercel.app`, pinned leads | Fresh load (Cmd+Shift+R) so the Checking lane shows first | Hover Katrin Huber card, hover Sabine Wagner's reason line | 15 s |
| 4 Hero | `https://marquee-reonic.vercel.app/h/db67b84935`, hero (read only) | Panels chip selected, 3D on, Proposed Design collapsed | Click the card from shot 3 (or open the URL), wait for the model, hover the two face labels, hover Shading, drag hour slider 13 to 17 | 27 s |
| 5 Chain | Same, hero (read only) | Panels selected | Battery, Wallbox, Heat pump chips, about 5 s each; open Why on Panels first if time allows | 33 s |
| 6 Proposed Design | Same, hero (read only) | Card collapsed | Click card header; scroll inside the card past the component list to the four variants; never click a variant or Approve | 18 s |
| 7 Kit change | `https://marquee-reonic.vercel.app/h/<test id>` from shot 2 | Draft, Proposed Design pass visible | Click Wallbox chip, hold; Battery size chooser, 10 kWh to 5 kWh; hold on the Proposed Design figures as they update | 30 s |
| 8 Approve | Same test lead | After shot 7 | Expand Proposed Design, Approve | 6 s |
| 9 Proposal and sign | `https://marquee-home.vercel.app/start/proposal/<test id>`, then `https://marquee-reonic.vercel.app` | Proposal at top | Scroll to Sign, type name, draw signature, tick "I accept this proposal", Sign; then load the board | 21 s |
| 10 Check | `https://marquee-reonic.vercel.app/check`, no lead | Top of page | Hold on the blue card, then scroll to the held-out home table | 24 s |
| 11 Close | `https://marquee-reonic.vercel.app/h/db67b84935`, hero (read only) | Panels chip, 3D | Optional slow drag to orbit; press nothing else | 20 s |

After capture: delete or reset the test lead so it never reaches the board, and check db67b84935 still reads Draft, 10.35 kWp, 10 kWh, €15,820.
