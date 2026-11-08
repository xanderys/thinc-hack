// The four systems the planner looks at, in Reonic's order and colours. A chip picks one; setSystem tells the scene.
// Until scene.setSystem lands (branch layers), SpatialDemo keeps framing the system through the chain's stage pose
// and layer; the event below is the one call site the real layers pick up.
export type SystemName = "panels" | "battery" | "wallbox" | "heatpump";

// icon: the kit sheet's rendered part, smallest band (web/public/kit, shared with KitSheet).
export const SYSTEMS: { key: SystemName; label: string; colour: string; ink: string; icon: string }[] = [
  { key: "panels", label: "Panels", colour: "#ffc043", ink: "#071b71", icon: "/kit/modules-1.png" },
  { key: "battery", label: "Battery", colour: "#24a148", ink: "#fff", icon: "/kit/battery-1.png" },
  { key: "wallbox", label: "Wallbox", colour: "#1c71ef", ink: "#fff", icon: "/kit/wallbox.png" },
  { key: "heatpump", label: "Heat pump", colour: "#e3634f", ink: "#fff", icon: "/kit/heatpump.png" },
];

// Chain stage (1 to 4) to its system, and back.
export const systemOf = (stage: number): SystemName | null => SYSTEMS[stage - 1]?.key ?? null;
export const stageOf = (k: SystemName) => SYSTEMS.findIndex((x) => x.key === k) + 1;

export const SYSTEM_EVENT = "marquee:system";

// One call: camera, layer and info block follow. The scene listens for the event and calls scene.setSystem(name);
// the last name stays on window so a scene that mounts later starts on it.
export function setSystem(name: SystemName | null) {
  if (typeof window === "undefined") return;
  (window as unknown as { __marqueeSystem?: SystemName | null }).__marqueeSystem = name;
  window.dispatchEvent(new CustomEvent(SYSTEM_EVENT, { detail: { name } }));
}
