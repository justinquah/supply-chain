# PO Workflow (Phase 4) — Build Summary

Staged Purchase Order workflow UI + server actions, built on the existing PO register.
App-code only — no migrations, no schema changes, no new dependencies. `npm run build` exits 0.

## The 5-state lifecycle

`DRAFT → PO_APPROVED → INVOICE_RECEIVED → SHIPPED → RECEIVED` (CANCELLED retained as terminal).

| From | Actor (+ ADMIN) | Action | → To |
|---|---|---|---|
| (create) | SCM | draft: supplier, product range, expected amount, deposit %, payment terms, deposit/balance due dates | DRAFT |
| DRAFT | ACCOUNTS | upload signed PO PDF, set po_number + targeted_eta | PO_APPROVED |
| PO_APPROVED | SCM | upload supplier invoice, key invoice_amount/number/date, confirm terms | INVOICE_RECEIVED |
| INVOICE_RECEIVED | LOGISTICS | upload BL + K1_FINAL, set actual_eta | SHIPPED |
| SHIPPED | WAREHOUSE | mark received (GATED) + optional remark/proof photo | RECEIVED |

ADMIN can perform any non-terminal stage action.

## Files

**Created**
- `src/lib/po-workflow.ts` — single source of truth: ordered states, labels/colors, the actor table (`PO_STAGE`), `canActOnState`, `waitingOnLabel`, `stateIndex`, `PO_DRAFT_CREATORS`.
- `src/app/(authed)/purchase-orders/[id]/page.tsx` — PO detail route (server component).
- `src/app/(authed)/purchase-orders/[id]/stepper.tsx` — 5-state horizontal stepper.
- `src/app/(authed)/purchase-orders/[id]/stage-forms.tsx` — client component; renders the actor's transition form for the current state and the SHIPPED→RECEIVED gate checklist.

**Changed**
- `src/app/(authed)/purchase-orders/actions.ts` — `savePurchaseOrder` now creates/edits **DRAFT** POs with the new fields; added `approvePO`, `recordInvoice`, `markShipped`, `markReceived`; shared `uploadDoc` helper; reuses existing bucket map + `getDocUrl`.
- `src/app/(authed)/purchase-orders/po-form.tsx` — draft form: supplier, product range, expected amount, currency, deposit %, payment terms, deposit/balance due dates. (Invoice/doc upload fields removed — those happen at later stages on the detail page.)
- `src/app/(authed)/purchase-orders/page.tsx` — added **Status** column (colored workflow badge) + amber "needs your action" dot; PO number links to detail; "New PO (draft)" gated to SCM/ADMIN.

## New routes + server actions

- Route: `GET /purchase-orders/[id]` — PO fields, stepper, documents (signed-URL open), `v_po_balance` card, and either the stage action form (if current user is the actor or ADMIN) or a read-only "waiting on X" note.
- Server actions (each does its own actor check + state check, returns `{ok,error}` not redirect):
  - `savePurchaseOrder` (SCM/ADMIN) — draft create/edit (edit only while DRAFT).
  - `approvePO` (ACCOUNTS/ADMIN) — DRAFT → PO_APPROVED.
  - `recordInvoice` (SCM/ADMIN) — PO_APPROVED → INVOICE_RECEIVED.
  - `markShipped` (LOGISTICS/ADMIN) — INVOICE_RECEIVED → SHIPPED.
  - `markReceived` (WAREHOUSE/ADMIN) — SHIPPED → RECEIVED.

## How the RECEIVED gate is enforced

`markReceived` hard-blocks server-side (cannot be bypassed by the UI):
1. **State check** — must currently be `SHIPPED`.
2. **Actor check** — `canActOnState(role, "SHIPPED")` (WAREHOUSE or ADMIN).
3. **Document gate** — queries `po_documents`; rejects with a named-missing message unless both `BL` **and** `K1_FINAL` rows exist.
4. **Balance gate** — reads `v_po_balance.balance_remaining`; rejects unless `= 0`, naming the outstanding amount.

The detail page mirrors this as a live checklist (BL / K1 / balance) so the user sees *why* it's blocked. Because payments are recorded by Finance (a later increment), balance legitimately stays non-zero and RECEIVED stays blocked until then — by design, not a bug. Each transition also stamps the actor/timestamp where columns exist (`proposed_by`, `approved_by`/`approved_at`, `issued_by`/`issued_at`).

## Notes / decisions

- `purchase_orders.supplier_id` is NOT NULL, so the draft form requires a supplier.
- `purchase_orders.currency` CHECK only allows MYR/USD; the expected/invoice currency uses the `invoice_currency` (`currency_code` enum: MYR/USD/CNY/THB) column instead. `currency` is left at its default.
- The receipt proof photo goes to the `receipt-photos` bucket. There is no matching `doc_type` enum value, so it is stored in the bucket only (not registered in `po_documents`); the receipt remark is appended to `purchase_orders.notes`.
- Joined `supplier`/`po_documents` shapes aren't in the generated DB types, so those rows are read loosely (`as any`), consistent with the existing list page.

## Build status

`npm run build` — **exits 0**. `/purchase-orders/[id]` registered as a dynamic route; TypeScript passes.

## Deferred (out of scope per brief)

- Finance payment UI (records payments that drive `balance_remaining` → 0; until built, RECEIVED stays gated).
- Warehouse goods-receipt detail (per-line qty/damage). The RECEIVED step here is the lightweight gated transition only.
- A dedicated `received_at`/`received_by`/receipt-photo-reference column (none exists this increment; remark stored in notes, photo in bucket).
- Could not exercise runtime auth flows (no login available) — verification is limited to a clean production build.
