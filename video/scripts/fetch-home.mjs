import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

// Roof model of the sample house (Bayerische Vermessungsverwaltung, CC BY 4.0).
const address = process.env.MODEL_ADDRESS || "Katharinenstraße 5, 82008 Unterhaching";
const get = async (url) => {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url);
    if (r.status !== 502) {
      if (!r.ok) { console.error(`Engine ${r.status}: ${await r.text()}`); process.exit(1); }
      return Buffer.from(await r.arrayBuffer());
    }
    if (i < 3) { console.error("502, retry in 60 s"); await new Promise((f) => setTimeout(f, 60000)); }
  }
  console.error(`Engine 502 at ${url}`);
  process.exit(1);
};
const q = `address=${encodeURIComponent(address)}${inputs.house_built_year ? `&build_year=${inputs.house_built_year}` : ""}`;
mkdirSync(new URL("../public/model/", import.meta.url), { recursive: true });
writeFileSync(new URL("../public/model/planes.json", import.meta.url), await get(`${base}/api/roof/model?${q}`));
writeFileSync(new URL("../public/model/house.glb", import.meta.url), await get(`${base}/api/roof/model/file?${q}`));
