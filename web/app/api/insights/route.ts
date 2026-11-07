import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Facts quoted from docs/data-insights.md so the page never carries its own numbers.
const PICK: { label: string; match: (l: string) => boolean }[] = [
  { label: "Wallboxes without an EV", match: (l) => /^8\.\s/.test(l) },
  { label: "Battery-only extension jobs", match: (l) => /battery-extension-only/.test(l) },
  { label: "Inputs limit accuracy", match: (l) => /^10\.\s/.test(l) },
];

export async function GET() {
  const file = path.join(process.cwd(), "..", "docs", "data-insights.md");
  let text: string;
  try { text = await readFile(file, "utf8"); } catch (e) {
    return NextResponse.json({ error: `Could not read docs/data-insights.md: ${(e as Error).message}` }, { status: 404 });
  }
  const lines = text.split("\n").map((l) => l.trim());
  const facts = PICK.flatMap(({ label, match }) => {
    const l = lines.find(match);
    return l ? [{ label, text: l.replace(/^\d+\.\s*/, "").replace(/\*\*/g, "").replace(/`/g, "") }] : [];
  });
  return NextResponse.json({ facts, source: "docs/data-insights.md" });
}
