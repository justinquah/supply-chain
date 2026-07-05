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

// ============================================================
// Shipment / clearance sub-workflow (ETD → ETA chain → receiving)
// ============================================================
// A PO's `clearance_status` tracks the physical shipment's progress through
// port and customs independently of the coarse PO_WORKFLOW_STATES. Mirrors the
// PO_WORKFLOW_* maps above. Ordered from earliest to latest.

export const CLEARANCE_STATUSES = [
  "IN_TRANSIT",
  "AT_PORT",
  "UNDER_CLEARANCE",
  "INSPECTION",
  "CLEARED",
  "TO_WAREHOUSE",
  "RECEIVED",
] as const;

export type ClearanceStatus = (typeof CLEARANCE_STATUSES)[number];

export const CLEARANCE_LABELS: Record<string, string> = {
  IN_TRANSIT: "In Transit",
  AT_PORT: "At Port",
  UNDER_CLEARANCE: "Under Clearance",
  INSPECTION: "Inspection",
  CLEARED: "Cleared",
  TO_WAREHOUSE: "To Warehouse",
  RECEIVED: "Received",
};

export const CLEARANCE_COLORS: Record<string, string> = {
  IN_TRANSIT: "bg-sky-100 text-sky-700",
  AT_PORT: "bg-blue-100 text-blue-700",
  UNDER_CLEARANCE: "bg-amber-100 text-amber-700",
  INSPECTION: "bg-orange-100 text-orange-700",
  CLEARED: "bg-teal-100 text-teal-700",
  TO_WAREHOUSE: "bg-indigo-100 text-indigo-700",
  RECEIVED: "bg-emerald-100 text-emerald-700",
};

/** True when `s` is a valid clearance status. */
export function isClearanceStatus(s: string | null | undefined): s is ClearanceStatus {
  return !!s && (CLEARANCE_STATUSES as readonly string[]).includes(s);
}

// The minimal shape needed by the ETA / payment helpers below. Any object with
// these date fields (a PO row, a supplier PO row, a partial patch) works.
export type EtaSource = {
  targeted_eta?: string | null;
  supplier_eta?: string | null;
  logistics_eta?: string | null;
  actual_eta?: string | null;
  payment_terms?: string | null;
};

/**
 * Current ETA to port — the most authoritative available estimate.
 * Logistics' estimate wins, then the supplier's, then SCM's ideal target.
 * Returns a plain 'YYYY-MM-DD' string or null.
 */
export function currentEtaToPort(po: EtaSource): string | null {
  return po.logistics_eta ?? po.supplier_eta ?? po.targeted_eta ?? null;
}

/**
 * Payment anchor date — the actual port arrival if known, else the current
 * ETA-to-port estimate. Balance payment terms count from this date (§5).
 * Returns a plain 'YYYY-MM-DD' string or null.
 */
export function paymentAnchorDate(po: EtaSource): string | null {
  return po.actual_eta ?? currentEtaToPort(po);
}

/**
 * Parse a day-count from a free-text payment-terms string.
 * Prefers an explicit "N day(s)" mention; falls back to a bare integer.
 * Returns the integer number of days, or null if none is parseable.
 */
export function parsePaymentTermDays(terms: string | null | undefined): number | null {
  if (!terms) return null;
  const withDay = terms.match(/(\d+)\s*day/i);
  if (withDay) return Number(withDay[1]);
  const bare = terms.match(/\d+/);
  if (bare) return Number(bare[0]);
  return null;
}

/**
 * Recompute a PO's balance_due_date from the payment anchor (§5).
 *
 * Returns the new 'YYYY-MM-DD' date when BOTH a day-count is parseable from
 * `payment_terms` AND a payment anchor date exists; otherwise returns null so
 * callers leave the manually-entered balance_due_date untouched.
 *
 * The date arithmetic uses a UTC-midnight anchor to stay off-by-one-safe: DATE
 * columns are treated as plain calendar dates (mirrors permits/expiry.ts).
 */
export function recomputeBalanceDue(po: EtaSource): string | null {
  const days = parsePaymentTermDays(po.payment_terms);
  if (days == null) return null;
  const anchor = paymentAnchorDate(po);
  if (!anchor) return null;
  const anchorMs = new Date(`${anchor}T00:00:00Z`).getTime();
  if (Number.isNaN(anchorMs)) return null;
  const due = new Date(anchorMs + days * 86_400_000);
  const y = due.getUTCFullYear();
  const m = String(due.getUTCMonth() + 1).padStart(2, "0");
  const d = String(due.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
