// ============================================================
// PO workflow — the brief's 5-state lifecycle (Phase 4)
// ============================================================
// DRAFT → PO_APPROVED → INVOICE_RECEIVED → SHIPPED → RECEIVED
//
// This module is the single source of truth for: the ordered states, their
// labels/colours, and WHICH role is the "actor" that drives each transition.
// Server actions enforce the same actor table app-side (RLS is the coarse gate).
// ============================================================

import type { AppRole } from "@/lib/supabase/server";

export const PO_WORKFLOW_STATES = [
  "DRAFT",
  "PO_APPROVED",
  "INVOICE_RECEIVED",
  "SHIPPED",
  "RECEIVED",
] as const;

export type PoWorkflowState = (typeof PO_WORKFLOW_STATES)[number];

export const PO_WORKFLOW_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PO_APPROVED: "PO Approved",
  INVOICE_RECEIVED: "Invoice Received",
  SHIPPED: "Shipped",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};

export const PO_WORKFLOW_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  PO_APPROVED: "bg-blue-100 text-blue-700",
  INVOICE_RECEIVED: "bg-indigo-100 text-indigo-700",
  SHIPPED: "bg-purple-100 text-purple-700",
  RECEIVED: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-red-100 text-red-700",
};

// The role(s) that act on a PO in a given state to advance it. ADMIN can act on
// any state (handled separately via canActOnState). The "next" state is what the
// transition produces.
type StageDef = {
  /** Roles (besides ADMIN) allowed to perform the stage action. */
  actors: AppRole[];
  /** Human label for who the PO is waiting on, e.g. "Accounts". */
  waitingOn: string;
  /** The state this transition produces. */
  next: PoWorkflowState | null;
};

export const PO_STAGE: Record<string, StageDef> = {
  // ACCOUNTS = FINANCE: either may approve a draft PO.
  DRAFT: { actors: ["ACCOUNTS", "FINANCE"], waitingOn: "Accounts", next: "PO_APPROVED" },
  PO_APPROVED: { actors: ["SCM"], waitingOn: "SCM", next: "INVOICE_RECEIVED" },
  INVOICE_RECEIVED: { actors: ["LOGISTICS"], waitingOn: "Logistics", next: "SHIPPED" },
  SHIPPED: { actors: ["WAREHOUSE"], waitingOn: "Warehouse", next: "RECEIVED" },
  RECEIVED: { actors: [], waitingOn: "", next: null }, // terminal
};

/** True when `role` may perform the stage action for `state` (ADMIN overrides). */
export function canActOnState(role: string | null | undefined, state: string): boolean {
  if (!role) return false;
  if (role === "ADMIN") return PO_STAGE[state]?.next != null; // ADMIN can drive any non-terminal state
  const stage = PO_STAGE[state];
  if (!stage) return false;
  return stage.actors.includes(role as AppRole);
}

/** Who the PO is currently waiting on (empty for terminal/unknown states). */
export function waitingOnLabel(state: string): string {
  return PO_STAGE[state]?.waitingOn ?? "";
}

/** Index of a state in the linear flow (-1 if not a workflow state, e.g. CANCELLED). */
export function stateIndex(state: string): number {
  return (PO_WORKFLOW_STATES as readonly string[]).indexOf(state);
}

/** Roles allowed to create a draft PO. */
export const PO_DRAFT_CREATORS: AppRole[] = ["SCM", "ADMIN"];
