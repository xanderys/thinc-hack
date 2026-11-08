import type { InstallerId } from "./api";

// docs/data-insights.md, medians in calendar time, past projects and not a promise. The only place these figures live.
// 23c108b7: enquiry to offer 8.2 days (n 260), offer to signature 28.7 days (n 320).
// 2a8ba8e2: offer to signature 20.0 days (n 1,276); enquiry to offer 0.7 days on 18 rows only, so it is left out.
export function pastLine(installer?: InstallerId | string | null): string {
  if (installer === "23c108b7") return "This installer's past projects: about 8 days to an offer, then about 29 days to a signature.";
  if (installer === "2a8ba8e2") return "This installer's past projects: about 20 days from offer to signature.";
  return "";
}
