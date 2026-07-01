# Warehouse Arrival Calendar + Goods Receipt (Phase 4C) — Build Summary

App-code only — schema already applied via migration `0017_warehouse_receipt_container.sql`.
No migrations, no schema changes, no new dependencies. `npm run build` exits 0.

## What was built

1. **Warehouse arrival calendar** — new `/warehouse` route showing a month calendar of
   expected container arrivals (one PO = one container), plus "arriving soon" and
   "awaiting unload" side lists.
2. **Warehouse goods-receipt capture** — extended the existing SHIPPED → RECEIVED
   actor form and `markReceived` server action to persist qty received/damaged,
   a remark, an optional proof photo, and container arrival/unload timestamps —
   surfaced read-only on the PO detail page with a derived unload duration.

## Files

**Created**
- `src/app/(authed)/warehouse/page.tsx` — server component, gated via
  `requireRole("WAREHOUSE", "ADMIN", "SCM", "LOGISTICS")` (write intent for
  WAREHOUSE/ADMIN, read-only banner for SCM/LOGISTICS, consistent with nav
  gating). Queries all non-RECEIVED, non-CANCELLED POs, computes KL "today",
  plots each PO on `COALESCE(actual_eta, targeted_eta)`, and builds the
  arrivals list + awaiting-unload list.
- `src/app/(authed)/warehouse/arrival-calendar.tsx` — client component. Month
  grid pattern adapted from `finance/payment-calendar.tsx` (prev/next nav,
  day-of-week header, padded cells). Each day cell shows PO number + supplier
  as a link to the PO detail page, colour-coded by urgency (red = overdue,
  amber = arriving within 3 days, neutral = later). Side panel: "Arriving
  soon" list (all POs with an ETA, sorted ascending, includes overdue) and
  "Awaiting unload" list (container_arrived_at set, unload_completed_at null).
- `src/app/(authed)/purchase-orders/[id]/receipt-proof-link.tsx` — small
  client button that resolves a signed URL for `receipt_proof_path` on click,
  same on-demand pattern as `DocBadges` (reuses `getDocUrl`).

**Changed**
- `src/app/(authed)/purchase-orders/actions.ts` (`markReceived`) — in addition
  to the existing hard gates (BL + K1_FINAL docs present, `v_po_balance.balance_remaining = 0`),
  now reads `received_qty`, `damaged_qty`, `container_arrived_at`,
  `unload_completed_at` from the form and persists them on the PO alongside
  `receipt_remark` (renamed from the old notes-append behaviour to the
  dedicated `receipt_remark` column) and `receipt_proof_path` (unchanged
  bucket/path convention: `receipt-photos/{poId}/receipt/{ts}_{filename}`).
  `unload_completed_at` defaults to `now()` server-side if the actor leaves it
  blank. Validates qty fields are non-negative numbers. Revalidates
  `/warehouse` in addition to the existing PO paths.
- `src/app/(authed)/purchase-orders/[id]/stage-forms.tsx` — the SHIPPED actor
  form gained four new inputs (container arrived date, unload completed
  datetime-local, received qty, damaged/short qty) above the existing
  remark + proof photo fields, with a note that these are informational and
  do not touch stock/KPI figures.
- `src/app/(authed)/purchase-orders/[id]/page.tsx` — selects the new receipt
  columns; new "Goods receipt" card renders whenever any receipt data exists
  (not gated strictly to RECEIVED, so a PO with `container_arrived_at` set
  while still SHIPPED also shows the card). Shows container arrived date,
  unload completed timestamp, a derived **unload duration** (unload_completed_at
  − container_arrived_at at 00:00 Asia/Kuala_Lumpur on the arrival date,
  formatted as `Xd Yh` / `Yh`), received/damaged qty, remark, and a
  `ReceiptProofLink` to the proof photo.
- `src/components/nav-bar.tsx` — added a "Warehouse" nav link gated to
  `WAREHOUSE, ADMIN, SCM, LOGISTICS`.

## How arrivals are plotted

Each PO not yet `RECEIVED`/`CANCELLED` is plotted on `COALESCE(actual_eta, targeted_eta)`
(same COALESCE convention already used for the Finance BA base date). `daysUntil`
is computed against "today" in Asia/Kuala_Lumpur (same `klTodayInfo()` pattern as
`finance/page.tsx`, duplicated locally rather than extracted to a shared helper —
see Deviations).

## Unload duration derivation

`container_arrived_at` is a `DATE` column (no time-of-day); `unload_completed_at`
is a `TIMESTAMPTZ`. Duration is computed as
`unload_completed_at - (container_arrived_at at 00:00 +08:00)`, floored to whole
hours and rendered as `Xd Yh` (or `Yh` under 24h). This is a display-only
approximation (arrival is date-only) — good enough for the "how long did
unloading take" signal the brief asks for, not a precise SLA metric.

## Deviations from Plan

None architecturally. Minor implementation notes (Rule 1/2 style, no user
input needed):

- **[Rule 2] `receipt_remark` moved off `notes`.** The pre-4C `markReceived`
  action appended the remark to the shared `notes` field (no dedicated column
  existed yet). Migration 0017 added `receipt_remark`; this build switches
  `markReceived` to write to that column directly instead of appending to
  `notes`, matching the schema's intent and avoiding notes-field pollution.
  Existing `[Received] ...` lines already appended to `notes` on prior POs are
  left untouched (historical data, not touched by this migration).
- **`klTodayInfo()` duplicated, not extracted.** `finance/page.tsx` and
  `warehouse/page.tsx` each have their own private copy of the Asia/KL
  "today" helper. Matches the existing per-page style (no shared `lib/date.ts`
  yet in this codebase); flagged here in case a future phase wants to
  consolidate.

No stubs — all data plotted comes from live `purchase_orders` queries, no
hardcoded/mock arrays.

## Deferred / out of scope

- No changes to the `shipment_receipts` / `receipt_photos` (per-product-line)
  tables from migration 0001 — the spec's "one PO = one container" model uses
  the new PO-level columns from migration 0017 instead, per the schema facts
  given.
- No stock/KPI snapshot changes — received/damaged qty are informational only,
  as required (WHS-01).

## Build

`npm run build` — exit 0. New route `ƒ /warehouse` appears in the route table
alongside the existing dynamic routes.
