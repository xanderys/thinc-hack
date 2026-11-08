// One plain line per offer, shared by the planner's variant rows (components/offer/VariantTabs.tsx) and the
// homeowner's options list (components/proposal/Proposal.tsx), so both surfaces say the same thing. No figures.
export type VariantLineKey = "expert" | "independence" | "payback" | "upfront" | "edit";
export const VARIANT_LINE: Record<VariantLineKey, string> = {
  expert: "What planners here fit to homes like this",
  payback: "Earns its cost back soonest",
  upfront: "Smallest outlay",
  independence: "Most of your own power",
  edit: "As you changed it",
};
