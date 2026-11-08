# Brief: WhatsApp copilot and facts chips (P1, Xander via Hack Chief-of-Staff, Sun 8 Nov 2026 05:20 Munich)

Locked picks: sender is the bridge line on the mini; the demo client is Xander himself (SG number 6586936789); scope is ask, parse, fill chips; beyond the demo this is a general "WhatsApp copilot" tool call so installers get input data fast. Rule kept: no LLM inside the engine process; the engine composes from templates and calls the web's interpreter for parsing.

## Bridge (live now)
- Health: `GET http://127.0.0.1:8013/health` (status open).
- Send: `POST http://127.0.0.1:8013/send` JSON `{"text": "..."}`, pinned to Xander's number (no approval needed, it is his own number).
- Inbox: `GET http://127.0.0.1:8013/inbox?after=<seq>` returns `{entries:[{seq, msg_id, chat_jid, ts, kind, text, ...}]}`; keep only entries from Xander's number; poll every 5 s while a question is open.

## A. Facts chips (web, Sonnet, branch `chips` from main)
Remove the "Style: Installer A" chip. Every chip gets a line glyph (bolt annual use, flame heating, tag price, car electric car, people household, ruler floor area, calendar built year, roof roof faces). Each chip opens a control fitted to its type, never a free text field: Household = stepper; Heating = segmented (Gas / Oil / Heat pump / District / Electric); Annual use, floor area, km a year = numeric field with the unit fixed plus a range slider; Built = year wheel, or decade segmented when estimated; Electric car = segmented (Have one / Planned / No) then km. Estimated values keep the estimated tone until stated. A missing fact shows an empty state with a dotted outline and the glyph. Edits write through the existing intake step (an explicit edit writes; a view never writes). Facts chip reads "Household use". Headless check at 390 and 1440 when a slot is given.

## B. WhatsApp client (engine side: ENGINE - Marquee; web side: Opus, branch `whatsapp-web` from main)
Engine (api v2.14, documented in docs/api.md):
- Lead model gains `phone` (E.164). Pinned demo leads carry Xander's number. Never message a lead without a phone.
- `POST /api/leads/{id}/whatsapp/ask {facts?: [...]}`: lists the missing or estimated facts in order of design impact (existing next-question logic), composes ONE natural message from templates in Rina's voice (German installer tone, British English for the demo, no bullets, at most two questions per message: "Hi Katrin, Rina here from the installer. Two quick things so I can finish your design: roughly how many kWh of electricity do you use a year, and is the house heated with gas or oil?"), sends it through the provider, stores it on the lead's `whatsapp` log, opens one conversation per lead (rate limit), returns `{conversation_id, sent, open_facts}`.
- Provider interface (`engine/app/whatsapp/provider.py`): `BridgeProvider` today (send + inbox poll on 8013), `CloudApiProvider` stub next (WhatsApp Business Cloud API) so any installer's number can be plugged in.
- Poll loop: while a conversation is open, poll the inbox every 5 s; each reply from the lead's number is sent to the web interpreter `POST <WEB_URL>/api/interpret` with `{mode: "whatsapp", lead_id, text, open_facts}` (intake secret header) which returns strict JSON `{facts: {field: value}, confidence, unclear: [...]}`; stated facts are written through the existing intake step with `source: "whatsapp"` so the design re-runs; an unclear reply gets one follow-up; stop when nothing is missing or after three rounds, then send "Thanks, that's everything, your design is ready" with the proposal link only if the lead is approved. Every message (both directions) is logged on the lead and returned by `GET /api/leads/{id}` as `whatsapp: {state, messages: [...]}`.
Web (Opus):
- One button in the facts row, "WhatsApp client". Press: `POST /api/leads/{id}/whatsapp/ask`; the button becomes a live state chip "Asking on WhatsApp" with a small thread popover showing the sent message and replies (from the lead's `whatsapp` log, polled); as facts arrive the chips fill with a "via WhatsApp" marker (source). When the conversation closes, the chip reads "Answered on WhatsApp" and the thread stays viewable.
- `POST /api/interpret` gains `mode: "whatsapp"` (claude-sonnet-5-5, the Anthropic key already on Vercel): prompt returns strict JSON of facts with confidence and an `unclear` list; no prose; never invents a value.
- Homeowner form (web/components/home/Start.tsx, lane 4): phone field, E.164, stored on the lead.

## C. General tool call
The same ask endpoint and provider interface are the "WhatsApp copilot" tool for any installer; docs/api.md v2.14 describes the request, the log shape and the provider contract.

Acceptance (A and B on one planner preview to the Chief-of-Staff, Xander replies from his phone): press the button on a test lead carrying Xander's number, a message arrives on his WhatsApp within 5 s, his free-text reply fills the right chips within 10 s with the "via WhatsApp" marker, the design re-runs, the thread popover shows both messages, a second round only when something is still missing, and nothing is sent for a lead without a phone.
