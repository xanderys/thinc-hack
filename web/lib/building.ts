// STUB on branch qualify: the real isMultiUnit lands on branch web; drop this file at rebase and keep theirs.
import type { HomeInputs } from "./api";

type Shape = { footprint_m2?: number | null; storeys?: number | null; dwellings_class?: string | null } | null | undefined;

export function isMultiUnit(roofModel: Shape, inputs: Partial<HomeInputs>): { multi: boolean; reason: string } {
  const dw = roofModel?.dwellings_class?.match(/\d+/);
  if (dw && Number(dw[0]) >= 3) return { multi: true, reason: `${roofModel!.dwellings_class} in this building (Zensus 2022)` };
  const fp = roofModel?.footprint_m2, st = roofModel?.storeys, stated = inputs.house_size_sqm;
  if (fp && st && stated && fp * st * 0.72 > 2.5 * stated) return { multi: true, reason: `the building has about ${Math.round(fp * st * 0.72)} m2 of floor, the home ${stated} m2` };
  return { multi: false, reason: "" };
}
