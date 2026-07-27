// Shared display metadata for the NPD (New Product Development) module.

// Project statuses — mirrors the npd_projects.status CHECK constraint.
export const NPD_STATUSES = [
  "ACTIVE",
  "LAUNCHED",
  "ON_HOLD",
  "CANCELLED",
] as const;
export type NpdStatus = (typeof NPD_STATUSES)[number];

export const NPD_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  LAUNCHED: "Launched",
  ON_HOLD: "On hold",
  CANCELLED: "Cancelled",
};

// Tailwind badge classes per status.
export const NPD_STATUS_BADGE: Record<string, string> = {
  ACTIVE: "bg-blue-50 text-blue-700 border border-blue-200",
  LAUNCHED: "bg-emerald-100 text-emerald-700 border border-emerald-200",
  ON_HOLD: "bg-gray-100 text-gray-500 border border-gray-200",
  CANCELLED: "bg-red-50 text-red-500 border border-red-100",
};

// The 7 fixed launch-checklist stages, in display order — mirrors the
// npd_checklist.stage CHECK constraint. Rows are seeded app-side on project
// create; SCM can tick/untick freely (real projects overlap stages).
export type NpdStageKey =
  | "FORMULATION"
  | "DESIGN"
  | "DVS_PERMIT"
  | "PLACE_PO"
  | "ARRIVAL"
  | "ONLINE_INFO"
  | "OFFLINE_CATALOG";

export type NpdStageMeta = {
  key: NpdStageKey;
  label: string;
  /** Optional wire-in link (e.g. DVS permits are managed on /permits). */
  href?: string;
  linkLabel?: string;
  /** Show/edit the stage's target_date inline (e.g. estimated arrival). */
  hasTargetDate?: boolean;
  targetLabel?: string;
};

export const NPD_STAGES: NpdStageMeta[] = [
  { key: "FORMULATION", label: "Formulation" },
  { key: "DESIGN", label: "Design & packaging" },
  {
    key: "DVS_PERMIT",
    label: "DVS permit application",
    href: "/permits",
    linkLabel: "manage in Permits",
  },
  {
    key: "PLACE_PO",
    label: "Place PO",
    href: "/purchase-orders",
    linkLabel: "go to POs",
  },
  {
    key: "ARRIVAL",
    label: "Stock arrival",
    hasTargetDate: true,
    targetLabel: "Est. arrival",
  },
  { key: "ONLINE_INFO", label: "Online product info" },
  { key: "OFFLINE_CATALOG", label: "Offline catalog update" },
];

export const NPD_STAGE_KEYS: NpdStageKey[] = NPD_STAGES.map((s) => s.key);

export const NPD_STAGE_COUNT = NPD_STAGES.length; // 7
