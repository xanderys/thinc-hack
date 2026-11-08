// Source and error words shown to people: no "estimated" marker, whatever the engine's own string says.
export const plainSource = (s: string) => s.replace(/^estimated (?:from )?(?:the )?/i, "").replace(/^./, (c) => c.toUpperCase());
export const plainError = (s: string) => s.replace(/Nothing is missing or estimated on this lead[^.]*\./i, "Nothing is missing on this lead.");
