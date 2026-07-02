// Shared display metadata for product-development statuses.

export const DEV_STATUS_LABELS: Record<string, string> = {
  PLANNED: "Planned",
  IN_PROGRESS: "In progress",
  LAUNCHED: "Launched",
  ON_HOLD: "On hold",
  CANCELLED: "Cancelled",
};

// Tailwind badge classes per status.
export const DEV_STATUS_BADGE: Record<string, string> = {
  PLANNED: "bg-slate-100 text-slate-600 border border-slate-200",
  IN_PROGRESS: "bg-amber-100 text-amber-700 border border-amber-200",
  LAUNCHED: "bg-emerald-100 text-emerald-700 border border-emerald-200",
  ON_HOLD: "bg-gray-100 text-gray-500 border border-gray-200",
  CANCELLED: "bg-red-50 text-red-500 border border-red-100",
};

export const DEV_STATUS_ORDER = [
  "PLANNED",
  "IN_PROGRESS",
  "LAUNCHED",
  "ON_HOLD",
  "CANCELLED",
] as const;
