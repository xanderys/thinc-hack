// Renders check frames of the Launch film: node scripts/launch-stills.mjs <outDir> <sec> [sec...]
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";
import fs from "node:fs";

const [outDir, ...times] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts"), publicDir: path.resolve("public") });
const composition = await selectComposition({ serveUrl, id: "Launch" });
for (const t of times) {
  const frame = Math.min(Math.round(Number(t) * composition.fps), composition.durationInFrames - 1);
  const output = path.join(outDir, `launch-${String(t).replace(".", "_")}s.png`);
  await renderStill({ serveUrl, composition, frame, output, scale: Number(process.env.SCALE ?? 1) });
  console.log(output);
}
fs.rmSync(serveUrl, { recursive: true, force: true });
