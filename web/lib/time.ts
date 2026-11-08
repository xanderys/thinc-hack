// One clock for every surface: the installer's, Europe/Berlin, whatever the visitor's browser or the Mac's zone says.
const D = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", day: "numeric", month: "short" });
const T = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false });

/** "08:15" */
export function berlinTime(iso?: string | null): string {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(+d) ? T.format(d) : "";
}
/** "8 Nov, 08:15" */
export function berlinStamp(iso?: string | null): string {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(+d) ? `${D.format(d)}, ${T.format(d)}` : "";
}
