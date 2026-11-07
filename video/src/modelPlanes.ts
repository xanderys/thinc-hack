// Only file that knows the planes.json schema.
// Local metres: x east, y north, z up. glTF axes: x east, y up, z south.
export type V3 = [number, number, number];
export type Panel = [V3, V3, V3, V3];
export type ModelData = { panels: Panel[]; centre: V3; licence: string | null };

export const toGl = ([x, y, z]: V3): V3 => [x, z, -y];

export function parsePlanes(json: any, pvKwp: number | null): ModelData {
  const planes: any[] = (json.planes ?? []).filter((p: any) => p.is_target && p.chosen_panels?.length);
  planes.sort((a, b) => (b.yield_kwh_per_kwp ?? 0) - (a.yield_kwh_per_kwp ?? 0));
  const all: Panel[] = planes.flatMap((p) => p.chosen_panels as Panel[]);
  const perPanel = json.layout?.panels ? json.layout.kwp / json.layout.panels : 0.45;
  const n = pvKwp == null ? 0 : Math.min(all.length, Math.round(pvKwp / perPanel));
  const panels = all.slice(0, n);
  const pts = planes.flatMap((p) => p.polygon as V3[]);
  const c = pts.reduce((t, p) => [t[0] + p[0], t[1] + p[1], t[2] + p[2]], [0, 0, 0]).map((v) => v / Math.max(1, pts.length)) as V3;
  return { panels, centre: c, licence: json.licence ?? null };
}
