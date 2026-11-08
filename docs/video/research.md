# Walkthrough video research (Marquee, 2 to 3 minutes)

Scope note: what was actually read is stated per source. Reonic reel notes, Linear, Aurora and 1KOMMA5 transcripts and the GitHub repos were read. OpenSolar, Raycast and Arc were only checked by title and length (no transcript pulled), so they carry no claims below.

## Sources

### 1. Reonic UK reel, "PV systems designed in under 5 minutes" (21 s, no speech, music only)
Local: `~/alfred/04. Resources/Swipe-File/2026-11-08 - Reonic UK reel - PV design in under 5 minutes.md`, `~/Projects/thinc-hack-refs/reonic-site/reel/`. Public: https://www.instagram.com/p/DfCTS8dHaRF/
- Copy: one idea per card, 1 to 2 s each, hard cuts on the beat.
- Copy: the number is the hero. A red seven-segment countdown runs over the 3D roof while panel strings appear plane by plane.
- Copy: the proposal PDF appears on a tablet for about 2 s as proof of the output, then a three-word claim card.
- Copy: it closes on the buyer's outcome ("Win More Jobs"), not the tech.
- Their visual language to match: navy ground, white bold type, off-white claim cards, one loud accent colour.

### 2. Aurora Solar, "Residential Enterprise Plan Demo" (15:41)
https://www.youtube.com/watch?v=8cjFBN1GOBE
- Copy: the opening sentence states the whole journey in order (create, design, storage, financing, plan set, sales mode). It is the agenda in one breath.
- Copy: the first action is entering an address and centring the pin, so the viewer sees the input before any output.
- Measured VO rate: 2,496 words in 941 s, about 2.65 words per second. That is a live walkthrough rate and is too dense for a 3 minute cut.
- Avoid: it narrates every click. It is a training video, not a pitch.

### 3. OpenSolar demos (title and length only, 11 to 25 minutes each)
https://www.youtube.com/watch?v=S6nmCVfSetA
- Takeaway from format alone: the category norm is a 10 to 25 minute full tour. A 2 to 3 minute cut that reaches a signed deal beats that by an order of magnitude, so say so on screen once, not in VO.

### 4. 1KOMMA5 (Enpal group peer), "Smart charge with Heartbeat" (41 s, German with English subs)
https://www.youtube.com/watch?v=3THoC5MHlv4
- Copy: three inputs named in one sentence (charge level, target, departure time), then "the AI does the rest". Inputs to outcome in one line.
- Copy: the pace is slow and about 1.8 words per second, so the UI gets time to be read.
- Avoid: the closing line is a slogan about tyres. Ours ends on the installer's outcome.
- Searched for an Enpal installer-side demo and found none public. 1KOMMA5 is the nearest peer.

### 5. Linear, "Introducing Linear Initiatives" (4:15) and "Intro to Linear" (4:00)
https://www.youtube.com/watch?v=FlDVDvzCmn0 and https://www.youtube.com/watch?v=9Q5BoiIFBiY
- Copy: the first sentence names the feature and the job it does for the user. The product is on screen within seconds.
- Copy: one running example (an imaginary ride-share company) so every screen belongs to one story. Ours is the single hero home.
- Copy: a colour state explained once, then used ("green is fine, yellow and red need me, grey means the update is missing"). Use this for confidence and deviation chips.
- Copy: a plain first-person register, no hype words. It also states the manual route it replaces ("no hunting through my inbox").
- A write-up of the Initiatives video notes the presenter sits in a small bubble while the UI keeps the full frame: https://www.motiontheagency.com/blog/product-launch-video-guide (secondary source, not checked in depth).

### 6. Raycast and Arc (not analysed)
Raycast "New Raycast. Coming 2026" (39 s, https://www.youtube.com/watch?v=Mi173xGb0ZA) and Arc 1.0 (35 s, https://www.youtube.com/watch?v=n5Vwrj1gEWs) were found but not studied. Treat as optional viewing for style, not as evidence for any rule.

### 7. GitHub: memex-lab/product-launch-video-skill (read in full)
https://github.com/memex-lab/product-launch-video-skill (`skills/product-launch-video/SKILL.md`)
- Copy: storyboard first as `storyboard.json`, with per-scene start, duration, VO text and transition. VO word count must fit the scene at about 2.5 words per second.
- Copy: show the product or its UI within the first 3 seconds; design for muted playback, so every key claim is also on screen.
- Copy: scene lengths: stat or logo 2 to 4 s, feature 3 to 5 s, full-screen demo 5 to 8 s, CTA 3 to 5 s. Transitions 200 to 400 ms, secondary fades 300 to 500 ms, primary springs 400 to 600 ms, stagger 80 to 200 ms.
- Copy: alternate fast and slow, never one tempo. No two consecutive showcase scenes with the same layout.
- Ignore: its "three motion layers per scene" and cinematic lighting advice. That suits a brand film, not a product walkthrough, and clashes with our no-AI-look rules.

### 8. GitHub: remotion-dev/skills (read the captions skill and file list)
https://github.com/remotion-dev/skills (`skills/remotion-captions`, `remotion-best-practices`, `remotion-render`)
- Copy: a clip's video and its captions live inside the same `<Sequence>`, so trimming or retiming moves both. Caption data is a `Caption[]` array, rendered with the Basic Captions element.
- Copy: transcribe the final VO to get word timings, then drive on-screen text from those, not from hand-set frames.
- Install if we render in Remotion: `npx skills add remotion-dev/skills`.

### 9. GitHub: auto-zoom screen recorders (README level)
OpenScreen https://github.com/AlanRoybal/openscreen-studio, Screenize https://github.com/syi0808/screenize (development paused since 22 May 2026), Recordly https://github.com/webadderallorg/Recordly
- Copy: record the cursor and clicks as a separate data stream, not baked into pixels. Zooms are then generated from click positions and the cursor is redrawn along a smoothed path with a click ripple. This is the whole trick behind the "Screen Studio look".
- For us: we drive the product from a script, so we know every click position. We can write the zoom keyframes ourselves and skip a recorder, or record with OpenScreen (MIT, Apple Silicon) and edit zooms on its timeline.

## Rules we take

1. **Length and budget.** 150 s total. Six beats: enquiry (15 s), design appears (30 s), why it chose this (25 s), planner refines, EV example (30 s), checked against experts across many projects (30 s), offer to signed deal and close (20 s).
2. **Shot length.** UI shots 4 to 6 s, the hero design reveal up to 8 s, number or stat cards 2 to 3 s, final card 4 s. Nothing under 1.5 s except the Reonic-style montage if we use one.
3. **UI in the first 3 seconds.** Open on the enquiry form with an address being typed. No logo sting, no title card before the product.
4. **VO rate.** 2.3 to 2.5 words per second, so about 340 to 370 words for 150 s. Aurora's 2.65 reads as a lecture. Write VO as plain first-person present tense, one idea per sentence, no adjectives like "powerful" or "seamless".
5. **VO register.** Linear's: a person who uses it, naming the manual step it removes ("no copying numbers between tools"). We show steps removed and decisions made consistent. We do not state hours or euros, as we have no time or price data.
6. **Zoom.** One zoom per shot at most. Zoom to 1.6x to 2x on the thing being talked about (size, battery, confidence chip), ease in over 0.4 s, hold at least 1.5 s, ease out. Cut back to full frame before the next action. Drive zooms from scripted click coordinates.
7. **Cursor.** Redrawn, smoothed along a curve, with a small click ripple. No jitter, no cursor parked in frame during a number reveal. Hide it when the number is the point.
8. **Numbers.** The way Reonic does it: one number, large, in the accent colour, on screen 2 to 3 s while VO says it once. Our hero numbers are the expert-match score on unseen projects and the seconds from enquiry to design. Count up or run a timer, then freeze it.
9. **Captions.** Burned-in, bottom third, sentence-level not word-by-word karaoke, max 2 lines, sentence case, same typeface as the UI. Generate from the final VO transcript so timings match. They carry every key claim, since the video may play muted.
10. **One hero home.** A single named home runs the whole video (Linear's ride-share company). The EV change is applied to that same home so the viewer sees the design adapt, not a new project.
11. **State colours explained once.** Say what the confidence and deviation chips mean the first time they appear, then use them silently (Linear's health dots).
12. **Close on the installer's outcome.** Last card is faster design, consistent offers, more signed deals, not a technology line. 4 s, no slogan, product name and one line.
13. **Look.** Take the palette from the installer's world (offer documents, data sheets, roof plans) as in the CLAUDE.md look rules. Transitions 200 to 400 ms, springs with no bounce. Show the generated proposal PDF for 2 s as proof of output, copying Reonic's tablet shot.

closed: nothing opened (no browser tabs, no background processes; yt-dlp subtitle downloads finished and exited; temp transcripts are in the session scratchpad).

## Music reference

Apple "Don't Blink" (https://www.youtube.com/watch?v=jk6sz25OZgw): the track is "Tiger Rhythm" by Surkin, a French electro-house track identified by Shazam on 8 Nov 2026 (two of three samples matched). It is a commercial track, so an upload carries a Content ID risk.
