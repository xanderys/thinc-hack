# Marquee overlay video

Remotion, 1920x1080, 30 fps, 120 s. Timings in `src/timeline.ts`.

**Footage.** Replace `public/footage/intro.mp4` (20 s) and `public/footage/demo.mp4` (90 s). The shipped files are placeholders.

**Anchors.** `npm run studio`, scrub to the x-ray phase (frame 270 on), read the footage position of each component as x/width, y/height, and enter four corners per keyframe in `src/anchors.ts`. For a moving shot add keyframes (`f` is the frame inside Intro); values are interpolated linearly. `PUSH` sets the push-in focus and zoom. Close Studio afterwards.

**Numbers.** `npm run fetch` calls `/api/refine` with `data/inputs.json` and writes `data/home.json`. `ENGINE_URL` overrides the engine.

**Captions.** `src/captions.ts`, seconds from the start of Demo.

**Render.** `npx remotion render Main out/marquee.mp4 --codec h264 --crf 18`
