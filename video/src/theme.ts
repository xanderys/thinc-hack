import { loadFont as loadMono } from "@remotion/google-fonts/IBMPlexMono";
import { loadFont as loadSans } from "@remotion/google-fonts/InstrumentSans";
import { loadFont as loadSerif } from "@remotion/google-fonts/InstrumentSerif";

loadMono("normal", { weights: ["400", "500"], subsets: ["latin"] });
loadSans("normal", { weights: ["400", "500"], subsets: ["latin"] });
loadSerif("normal", { weights: ["400"], subsets: ["latin"] });

export const PAPER = "#F4F1EA";
export const INK = "#0A0C14";
export const BLUE = "#0D1BFE";
export const PAPER_2 = "rgb(244 241 234 / .72)";
export const RULE_DARK = "rgb(244 241 234 / .22)";
export const MONO = '"IBM Plex Mono", monospace';
export const SANS = '"Instrument Sans", sans-serif';
export const SERIF = '"Instrument Serif", serif';
