# Marquee intake (voice)

The homeowner taps a short form, then Rina (an ElevenLabs agent) calls them in the browser and asks only what the form did not cover. The planner opens the lead with a design ready. Nothing is stored by us: the call and the form answers live in ElevenLabs.

- `SCRIPT.md`: call design. `prompt.md`: system prompt. `intake_fields.json`: post-call data collection fields (25 max on Creator).
- `create_agent.py`: creates or updates tool and agent, writes `agent.json`. Key from `voice/.env` or `~/.config/marquee/elevenlabs.env`.
- `simulate.py out.json [plain|dontknow]`: text-only test call with a simulated homeowner.
- `logs.py`: pulls call transcripts into `voice/logs/` (gitignored).
- `MarqueeCall.tsx`: planner-side call without the form (optional).
- `web/app/start/`: the homeowner widget, the lead routes and `intake.ts` (form variables, merge, mapping to `HomeInputs`).

Agent: public, voice Lucy (`lcMyyd2HUfFzxdCaC4Ta`, young British female), LLM `claude-haiku-5-5`, TTS `eleven_v4_turbo` at 1.15, calls capped at 7 minutes. No tools except end_call and no required dynamic variables, so the ElevenLabs talk-to page works too. Ids in `agent.json`.

## Flow
1. `/start?installer=2a8ba8e2` : form (postcode, house, people, bill band, heating, EV, interests, optional first name). Submit starts the call with a first-message override and sends the answers to Rina as a contextual update; they are also stored with the conversation as dynamic variables.
2. Rina asks: living space, daytime presence, kWh check, heating age and cost, EV mileage (if any), existing solar/battery/wallbox, priority, monthly payment, timeline. One attempt per question. Recap, "Perfect, thanks! Bye bye.", end_call.
3. ElevenLabs extracts the call facts after the call (data collection). The homeowner sees only the thank-you screen. In an iframe the page posts `{ type: "marquee:lead", conversation_id }` to the parent.
4. Planner: `GET /start/leads` lists recent calls; `GET /start/lead/<conversation_id>` returns 202 `{ pending: true }` until the analysis is in (a few seconds after the call), then `{ facts, sources, inputs, design, design_error, complete }`. `sources` marks each field `form`, `call` or `estimated`. `voice/MarqueeCall.tsx` polls this after a planner-side call and passes the result to `onIntake(facts, inputs, design)`.

## What STAGE must add
1. `cd web && npm i @elevenlabs/react@1.21.1` (package.json is not changed on this branch).
2. Vercel env: `ELEVENLABS_API_KEY` (server only), `ENGINE_URL` (already there), optionally `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` (defaults to the id above).
3. Planner side: an inbox row per item from `/start/leads`, opening `/start/lead/<id>` and rendering `design` with the existing DesignSheet; show `sources` next to each fact.
4. Embedding: no frame-ancestors header is set, so `<iframe src=".../start" allow="microphone">` works. The `allow="microphone"` attribute is required.
5. `start.css` hides the planner masthead on `/start` with `body:has(.start-root)`. If STAGE moves planner pages into a route group later, delete those three lines.

## Intake to engine
| Intake | HomeInputs |
|---|---|
| `annual_demand_kwh` (said, or bill x 12 / 0.37 EUR, / 0.27 GBP), else household (2: 2,500, 3: 3,500, 4: 4,500) | `annual_demand_kwh` |
| bill only: 37 ct; bill with a stated kWh: implied price | `electricity_price_ct_kwh` |
| `num_inhabitants`, `home_office` | `num_inhabitants`, `load_profile` (1 + home: HomeOfficeOnePerson, 4: FamilyOfFour, else H0) |
| `house_size_sqm`, `house_built_year` | same |
| `heating_type` (form Electric: OtherNonRenewable, Other: Unknown), cost, demand | same |
| `ev` now or planned, `ev_annual_km` | `has_ev`, `ev_annual_km` (default 12,000) |
| `has_solar`, `existing_solar_kwp`, `has_storage`, `existing_storage_kwh`, `has_wallbox` | same |
| `address` (postcode) | `address` |
| `preference` | `preference` |
| `property_type`, `interests`, `heating_age`, `ev_planned_when`, `timeline`, `budget_monthly_eur`, `bill_currency`, `notes`, `summary` | planner only |

Build year is never asked; infer it from the address.

Bill bands: under 60 = 50 EUR, 60 to 100 = 80, 100 to 150 = 125, over 150 = 180.

## Starting a call from another site (STAGE enquiry page)
The agent's own first message and prompt use no variables, so the plain talk-to link always works (ElevenLabs placeholders do not apply at runtime: a referenced variable that is not sent closes the call with "Missing required dynamic variables"). The enquiry page passes everything at start:
```ts
conversation.startSession({
  agentId: "agent_4201m6v70wckem7sd6nq4mkt40s4",
  connectionType: "webrtc",
  userId: `${customer_name}|${address_or_postcode}`,               // lets /start/leads show the live call by name
  dynamicVariables: { customer_name, address_or_postcode, installer_name, installer_id, house_type, people, monthly_bill_eur,
                      kwh_estimate, heating, ev, interests, floor_area_m2, multi_unit },   // all strings; omit unknowns
  overrides: { agent: { firstMessage: `Hi ${customer_name}, it's Rina from ${installer_name}. Just to check, are you living at ${address_or_postcode}?` } },
});
// in onConnect:
conversation.sendContextualUpdate(`Enquiry (never ask these again): installer ${installer_name}; name ${customer_name}; address ${address_or_postcode}; ` +
  `house type ${house_type}; people ${people}; bill about ${monthly_bill_eur} EUR a month, about ${kwh_estimate} kWh a year; ` +
  `heating ${heating}; electric car ${ev}; interested in ${interests}; living space ${floor_area_m2} m2; multi-unit building ${multi_unit}. ` +
  `You have already asked whether they live at the address.`);   // leave out parts that are unknown
```
Values: `house_type` detached, semi_detached, terraced, apartment; `heating` Gas, Oil, Heatpump, Electric, Other; `ev` now, planned, none; `multi_unit` "true" or "false"; `installer_id` 2a8ba8e2 (default) or 23c108b7. Only name and address are required.

Why the first /start test seemed not to start: the call did connect (conv_0901m6v9stsee71a1d1eb0b16wm1, Rina spoke, the transcript shows background speech and "Are you still there?"), so the failure was audio on the phone, not the session. On iPhone, audio output only plays if an audio context is unlocked inside the tap itself, and a ringer switch on silent can mute web audio. On the Accept button, call `navigator.mediaDevices.getUserMedia({ audio: true })` and `new AudioContext().resume()` synchronously in the click handler before `startSession`, keep the call screen visible with a "Speaking / Listening" state, and show any `onError` text with a retry.

## GET /start/leads (live inbox)
Polled every 3 s; the ElevenLabs list is cached for 2 s and names per call are cached in memory.
```ts
{ conversation_id: string; status: "in_progress" | "done" | "failed"; started_at: number | null /* unix s */;
  call_secs: number | null; customer_name: string | null; address_or_postcode: string | null; title: string | null }[]
```
Finished calls under 45 s or without a customer name are left out. `in_progress` covers the live call and the few seconds of post-call analysis; `done` means `/start/lead/<id>` returns the facts and design. While live, name and address come from `userId`; after the call, from the dynamic variables.
