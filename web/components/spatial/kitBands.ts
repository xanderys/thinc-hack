// The kit's size bands, shared by the 3D scene (kitMeshes.ts) and the parts list (KitSheet.tsx), so the battery on
// the house and its row icon are the same tower. No three.js in here: the parts list loads it on its own.
// One module layer per eight modules, one to five.
export const moduleLayers = (n: number) => (n <= 8 ? 1 : n <= 16 ? 2 : n <= 24 ? 3 : n <= 32 ? 4 : 5);
// One battery module per 3 kWh, one to six: 5 kWh is 2, 7 is 3, 10 is 4, 15 is 5.
export const batteryModules = (kwh: number) => Math.min(6, Math.max(1, Math.ceil(kwh / 3)));
