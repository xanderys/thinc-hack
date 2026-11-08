// A lead's phone is shown masked ("+65 •••• 6789": country code and the last four digits) everywhere except the open Phone control.
const CC = ["65", "44", "49", "61", "1", "33", "31", "41", "43", "39", "34", "91", "86", "81"];
export function maskPhone(e: string): string {
  const d = e.replace(/\D/g, ""), cc = CC.find((c) => d.startsWith(c) && d.length - c.length >= 6) ?? d.slice(0, 2);
  return `+${cc} •••• ${d.slice(-4)}`;
}
/** Masks any phone-looking number inside free text (a WhatsApp message, a note). */
export const maskPhonesIn = (t: string) => t.replace(/\+\d[\d\s().-]{7,}\d/g, (m) => maskPhone(m));
