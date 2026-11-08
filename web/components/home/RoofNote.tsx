// api v2.12: the design follows the LoD2 roof faces. When the homeowner's stated direction is not among them,
// the lead's stored draft carries roof { stated_direction_conflict, note }; the engine's note is shown as written.
// Older leads have no roof block and show nothing.
import type { DesignResponse } from "@/lib/api";

type RoofCheck = { stated_direction_conflict?: boolean; note?: string | null };

export default function RoofNote({ draft, className }: { draft: DesignResponse | null | undefined; className?: string }) {
  const roof = (draft as (DesignResponse & { roof?: RoofCheck }) | null | undefined)?.roof;
  if (!roof?.stated_direction_conflict || !roof.note) return null;
  return <p className={className}>{roof.note}</p>;
}
