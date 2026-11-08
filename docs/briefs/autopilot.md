# Brief: Autopilot (headline feature, Xander, Sun 8 Nov 2026 10:40 Munich)

The one item allowed past the 11:30 cut. Merge by 12:10, in the 12:30 final deploy, filmed by VIDEO at 12:30. Two lanes: ENGINE - Marquee owns `engine/`; the web lane (branch `autopilot`, worktree `~/Projects/thinc-hack-wt/autopilot`) owns `web/`. Neither blocks the units, sku and home-scene goes. Contract below is final unless the orchestrator changes it; `docs/api.md` v2.17 carries it.

## A. Board reshape (web)
1. Only a lead with a finished design and a 3D roof model renders as a big card with the 3D thumbnail. Every other lead (no model, no design yet, postcode only) is a short row: name, address or postcode, verdict chip, gap chips. No illustration on rows; the isometric cartoon house is deleted from the board.
2. Sabine Wagner (postcode-only demo lead ed63af6035) leaves the pinned demo set: engine unpins her (`pinned: false`, kept as `test: true`); the demo set is Huber, Lindner, Moser plus whatever autopilot creates.
3. Gap chips on cards and rows: each missing or estimated fact is a chip "Needs: heating type", "Needs: address", from `sources` (missing or `estimated`). Tap opens a one-line field to enter it (intake step, `source: "planner"`) or an "Ask" action that sends Rina's WhatsApp question for that fact (`POST /api/leads/{id}/whatsapp/ask {facts: [field]}`). Autopilot uses the same path.

## B. Composer (web)
At the bottom of the board, one rounded field with attach and mic glyphs and a send arrow; grows with text; sits above the safe area on phone. The planner types a scrap ("Huber, Katharinenstr 5 Unterhaching, 4 people"), pastes an email, or holds the mic for a voice note (ElevenLabs STT through the engine's existing transcription, same parse path as WhatsApp voice notes).
- Web `POST /api/interpret` gains `mode: "composer"` → `{name?, address?, postcode?, num_inhabitants?, heating_type?, heating_stated?, has_ev?, ev_planned?, annual_demand_kwh?, phone?, note?}` (claude-sonnet-5-5, the only LLM, in `web/`).
- Then the web creates the lead (`POST /api/leads` with `test: true` and the demo phone when none is given), runs the intake step with the facts (`source: "email" | "voice" | "planner"`), and the card or row appears at the top with its verdict and gap chips, skeleton states throughout, no captions.
- The composer answers in one short line in Rina's voice, from a fixed template per step, never free text from the model: "Got it, measuring the roof at Katharinenstraße 5." then the card fills in live.
- Voice: `POST /api/leads/transcribe` (engine, multipart audio) → `{text}`; the web then parses the text like a scrap.

## C. Autopilot (engine + web)
- Button "Run autopilot" at the top of the board. Engine `POST /api/autopilot/run` header `X-Intake-Secret`, body `{lead_ids?: string[], dry?: boolean}` → `text/event-stream`. Without `lead_ids` it takes every lead that is a draft with gaps or unsent, never a pinned lead unless listed. Each event is one JSON line `{at, lead_id, name, step, text, glyph, state: "active" | "done" | "needs_you" | "error", summary?: {sent, needs_you, asked}}`. Steps in order per lead: `read` ("Read Weber's email"), `measure` ("Measured the roof, 23 modules fit"), `ask` ("Asked Weber on WhatsApp about heating"), `draft` ("Draft 9.3 kWp, Priority"), `send` ("Sent the proposal"), `needs_you` ("Needs you: shared roof", "No reply yet"). Final event `step: "summary"` ("7 proposals sent, 2 need you").
- Rules per lead: read the intake (email, voice note, WhatsApp thread), design, qualify, ask the homeowner on WhatsApp for the top missing facts (real sends; the demo phone is on demo and test leads; one open conversation per lead, 2 h expiry), wait for replies within the run's window (`wait_s`, default 45) and re-run, complete and send the proposal when the verdict is Priority and nothing is missing, else flag. Never send to a number not on the lead. Rate limits respected. `ENGINE_AUTOPILOT_NIGHTLY=1` enables the nightly run at 04:30 Europe/Berlin (flag only, off by default).
- `GET /api/autopilot/status` → `{running, started_at, events_n, last}`.
- Web: a live agent log panel slides up from the composer while it runs: one line per event with the lead name, Berlin time and glyph; apple-motion springs; skeleton on the active line; the summary line closes it. The board updates cards and rows as events land (refetch the lead on `draft`, `send`, `needs_you`).

## Seed for the shoot
Engine `POST /api/autopilot/seed` (secret) creates six test enquiries on real Munich addresses with LoD2 so a run takes 60 to 90 s on screen: two pasted emails, one voice note transcript, three composer scraps; all `test: true`, phone = demo phone; returns the lead ids. Idempotent (re-seeding deletes its previous six).

## Guardrails
Never touch pinned demo leads except as inputs the planner chose. No real send to any number but the one on the lead. Headless checks only, under `/tmp/marquee-browser.lock`, read-only on pinned leads. Copy: British English, no em dashes, no loading captions (skeletons), essential text only. Report ends "closed: <list>".
