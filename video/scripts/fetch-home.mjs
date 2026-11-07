import { readFileSync, writeFileSync } from "node:fs";
const base = process.env.ENGINE_URL || "https://xanders-mac-mini.tail3f074b.ts.net:8443";
const inputsPath = process.argv[2] || new URL("../data/inputs.json", import.meta.url).pathname;
const inputs = JSON.parse(readFileSync(inputsPath, "utf8"));
const res = await fetch(`${base}/api/refine`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ inputs, overrides: { heatpump_kw: "include" } }),
});
const text = await res.text();
if (!res.ok) {
  console.error(`Engine ${res.status}: ${text}`);
  process.exit(1);
}
const { design, explanation, economics } = JSON.parse(text);
writeFileSync(new URL("../data/home.json", import.meta.url), JSON.stringify({ inputs, design, explanation, economics }, null, 2) + "\n");
console.log(JSON.stringify(design));
