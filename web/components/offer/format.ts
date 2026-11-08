// Number words for the Offer panel, en-GB grouping, never more decimals than the size needs.
export const n0 = (x: number) => Math.round(x).toLocaleString("en-GB");
export const n1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString("en-GB");
export const n2 = (x: number) => (Math.round(x * 100) / 100).toLocaleString("en-GB");
export const pc = (x: number) => `${Math.round(x * 100)} %`;
export const eur = (x: number) => `${x < 0 ? "-" : ""}€${n0(Math.abs(x))}`;

// Reonic's component colours (globals.css carries the same values as tokens).
export const COLOUR = { pv: "#ffc043", inverter: "#071b71", battery: "#24a148", wallbox: "#1c71ef", heatpump: "#e93f25", grid: "#52525b" } as const;
export type Part = keyof typeof COLOUR;
