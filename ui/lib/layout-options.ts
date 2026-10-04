export const groupingModes = [
  { value: "scanned", label: "Scanned groups" },
  { value: "service-type", label: "Service type" },
  { value: "ungrouped", label: "Ungrouped" },
] as const;

export type GroupingMode = (typeof groupingModes)[number]["value"];
