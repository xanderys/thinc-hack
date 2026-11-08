import { NextRequest, NextResponse } from "next/server";
import { numbersIn, structured } from "@/lib/llm";
import { CACHED_WRITE } from "@/lib/demo";

export const dynamic = "force-dynamic";

const KEYS = ["pv", "battery", "heatpump", "wallbox"] as const;

const schema = {
  type: "object", additionalProperties: false, required: ["text", "lines"],
  properties: {
    text: { type: "string" },
    lines: { type: "object", additionalProperties: false, required: [...KEYS], properties: Object.fromEntries(KEYS.map((k) => [k, { type: "string" }])) },
  },
};

const SYSTEM = {
  planner: `You are the drafting agent inside a solar installer's planning tool, writing for the planner. From the facts only:
text: two sentences, at most 45 words in all, in the first person. The first says what you would offer, in sizes (solar kWp, battery kWh, and any heat pump or wallbox); never mention the inverter. The second says it is sized the way this installer sizes family homes like this one, and may add what similar homes got. Never state a ratio such as kWp per 1,000 kWh or kWh per kWp. Leave out battery cycles, clipping and roof area.
lines: for each component (pv, battery, heatpump, wallbox) one plain sentence of at most 14 words the planner can say to the homeowner about it, with no ratios; when it is not offered, say why in plain words, never as a count such as 0 of 15.
Rules: British English. Copy every number exactly as written in the facts; use no number that is not in the facts. No adjectives of quality (great, ideal, perfect, optimal). Never say a part covers, serves or was sized for the electric car unless the facts say so; the wallbox is what the car adds. No em dashes. No sales talk. Never mention laws, permits, registration, the grid operator, subsidies, feed-in rules, tariffs or liability.`,
  homeowner: `You write for the homeowner who received this offer, from the facts only.
text: two or three short sentences in the second person, saying what the system is and what it does for their home.
lines: for each component (pv, battery, heatpump, wallbox) one plain sentence of at most 14 words; when it is not offered, say why.
Say only what it does for them. Leave out mechanics: battery cycles, inverter, clipping, ratios, roof area, tolerances and how planners size systems.
State only the size they get. Never compare it with another size, never mention what was first asked, requested or planned.
Rules: British English. Copy every number exactly as written in the facts; use no number that is not in the facts. No adjectives of quality. No em dashes. No sales talk. Never mention laws, permits, registration, the grid operator, subsidies, feed-in rules, tariffs or liability.`,
};

export async function POST(req: NextRequest) {
  let facts: string[], mode: "planner" | "homeowner";
  try { ({ facts, mode = "planner" } = await req.json()); } catch { return NextResponse.json({ error: "Body is not JSON" }, { status: 400 }); }
  if (!Array.isArray(facts) || facts.length === 0) return NextResponse.json({ error: "No facts to write from." }, { status: 400 });

  // Homeowner copy: what the system does for them, never the mechanics. The facts that carry mechanics are not sent,
  // and any sentence that still mentions them is dropped.
  const MECH = /\bcycles?\b|DC\/AC|clipp|kWh per kWp|per 1,000 kWh|within tolerance|signed homes|inverter/i;
  if (mode === "homeowner") facts = facts.filter((f) => !/^Battery does|^DC\/AC|needs about .* m2; usable roof|requested|first asked/i.test(f));
  const r = await structured<{ text: string; lines: Record<(typeof KEYS)[number], string> }>(SYSTEM[mode] ?? SYSTEM.planner, facts.map((f) => `- ${f}`).join("\n"), schema);
  if (!r.ok) {
    const hit = mode === "planner" ? CACHED_WRITE[facts.join("\n")] : undefined;
    return hit ? NextResponse.json({ ...hit, cached: true }) : NextResponse.json({ error: r.error }, { status: r.status });
  }

  // Grounding: every number in the prose must appear in the facts.
  const allowed = new Set(facts.flatMap(numbersIn));
  const ok = (s: string) => typeof s === "string" && s.trim() !== "" && !/[—–]/.test(s) && numbersIn(s).every((n) => allowed.has(n));
  // A homeowner never sees a superseded or internal size: "rather than the 8.1 kWp first asked" goes, and a sentence
  // that still talks about what was asked or requested is dropped.
  const ASKED = /\b(first asked|asked for|requested|first planned|originally)\b/i;
  const plain = (t: string) => mode !== "homeowner" || typeof t !== "string" ? t : t
    .replace(/,?\s*(?:rather than|instead of|down from|up from|compared with)\b[^!?]*?(?=\.(?:\s|$)|[!?]|$)/gi, "")
    .split(/(?<=[.!?])\s+/).filter((x) => !MECH.test(x) && !ASKED.test(x)).join(" ").replace(/\s+([.!?])/g, "$1");
  const lines = Object.fromEntries(KEYS.map((k) => { const l = plain(r.data.lines?.[k]); return [k, ok(l) ? l : null]; }));
  const text = plain(r.data.text), grounded = ok(text);
  return NextResponse.json({ text: grounded ? text : "", grounded, lines });
}
