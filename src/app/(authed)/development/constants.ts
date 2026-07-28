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

/**
 * Checklist progress with N/A support: total = stages NOT marked
 * not_applicable, done = stages done AND applicable. A stage that is done but
 * later marked N/A counts as neither. Missing seed rows count as applicable
 * not-done.
 */
export function checklistProgress(
  rows: { stage: string; done: boolean; not_applicable?: boolean }[]
): { done: number; total: number } {
  const byStage = new Map(rows.map((r) => [r.stage, r]));
  let done = 0;
  let total = 0;
  for (const key of NPD_STAGE_KEYS) {
    const row = byStage.get(key);
    if (row?.not_applicable) continue;
    total += 1;
    if (row?.done) done += 1;
  }
  return { done, total };
}

// ---------------------------------------------------------------------------
// Project type + revision kinds — mirrors the npd_projects.project_type /
// revision_kind CHECK constraints (migration 0046). revision_kind is set only
// when project_type = 'REVISION'.
// ---------------------------------------------------------------------------
export const NPD_PROJECT_TYPES = ["NEW_PRODUCT", "REVISION"] as const;
export type NpdProjectType = (typeof NPD_PROJECT_TYPES)[number];

export const NPD_REVISION_KINDS = [
  "FORMULA",
  "PACKING_DESIGN",
  "ADDED_VALUE",
  "ADDED_FUNCTION",
  "SIZE_CHANGE",
  "OTHER",
] as const;
export type NpdRevisionKind = (typeof NPD_REVISION_KINDS)[number];

export const NPD_REVISION_KIND_LABELS: Record<string, string> = {
  FORMULA: "Formula revision",
  PACKING_DESIGN: "Packing design",
  ADDED_VALUE: "Added value",
  ADDED_FUNCTION: "Added function",
  SIZE_CHANGE: "Size change",
  OTHER: "Other",
};

/** Supplier display name — company name first, personal name as fallback. */
export function supplierDisplayName(
  s: { name: string | null; company_name: string | null } | null | undefined
): string | null {
  if (!s) return null;
  return s.company_name || s.name || null;
}

// ---------------------------------------------------------------------------
// DVS dossier — documents required for the DVS permit application, mirrors
// the npd_documents.doc_type CHECK constraint. Multiple files per type are
// allowed (e.g. two mock-ups); "complete" = at least one file per applicable
// type. SPIE_LETTER counts only when the project's spie_applicable flag is
// true (SPIE letters are for NON-fish-ingredient pet food).
// ---------------------------------------------------------------------------
export type NpdDocType =
  | "CFS_COO"
  | "DIELINE"
  | "MOCKUP"
  | "INGREDIENT_LIST"
  | "COA"
  | "SPIE_LETTER";

export type NpdDocMeta = {
  key: NpdDocType;
  label: string;
  /** Small grey caption under the label. */
  caption?: string;
};

export const NPD_DOC_TYPES: NpdDocMeta[] = [
  { key: "CFS_COO", label: "Certificate of Free Sale / Certificate of Origin" },
  { key: "DIELINE", label: "Packaging dieline" },
  { key: "MOCKUP", label: "Packaging mock-up" },
  { key: "INGREDIENT_LIST", label: "Ingredient list" },
  { key: "COA", label: "Certificate of Analysis" },
  {
    key: "SPIE_LETTER",
    label: "SPIE letter",
    caption: "non-fish ingredient pet food only",
  },
];

export const NPD_DOC_TYPE_KEYS: NpdDocType[] = NPD_DOC_TYPES.map((d) => d.key);

/**
 * Dossier completeness: done = applicable doc types with at least one file,
 * total = 5 + (SPIE applicable ? 1 : 0).
 */
export function dossierProgress(
  docs: { doc_type: string }[],
  spieApplicable: boolean
): { done: number; total: number } {
  const applicable = NPD_DOC_TYPES.filter(
    (t) => t.key !== "SPIE_LETTER" || spieApplicable
  );
  const present = new Set(docs.map((d) => d.doc_type));
  return {
    done: applicable.filter((t) => present.has(t.key)).length,
    total: applicable.length,
  };
}
