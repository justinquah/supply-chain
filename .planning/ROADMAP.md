# Roadmap: JJANGX3 Supply Chain

## Overview

Four phases take JJANGX3's supply chain from the current Supabase rebuild to a 1 July 2026 go-live. Phase 1 clears the deck (strips marketplace/legacy code, locks the four-role model). Phase 2 builds the data backbone — schema, FY helpers, weekly stock upload, and the KPI engine that turns snapshots into Overstock %/OOS % scores. Phase 3 surfaces those scores in a dashboard with period switching and drill-down. Phase 4 delivers the PO lifecycle end-to-end with Finance payments and in-app notifications. Phases are largely sequential (each depends on the prior), with parallel plans inside each phase.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [ ] **Phase 1: Foundation & Roles** - Strip out-of-scope code, lock the four-role auth model, green production login
- [ ] **Phase 2: KPI Engine & Stock Upload** - Schema, FY helpers, weekly stock parser, and KPI classification/aggregation views
- [ ] **Phase 3: KPI Dashboard** - Overstock %/OOS %/Healthy % tiles with FY/Quarter/Month switcher and drill-down
- [ ] **Phase 4: PO Workflow & Finance** - End-to-end PO lifecycle, Finance payments, document storage, in-app notifications

## Phase Details

### Phase 1: Foundation & Roles

**Goal**: Remove all out-of-scope code, establish exactly five role-gated identities, and ensure production serves login cleanly — a clean base for the KPI and PO work.
**Depends on**: Nothing (first phase)
**Requirements**: FND-01, FND-02, FND-03, AUTH-01, AUTH-02, AUTH-03
**Success Criteria** (what must be TRUE):

  1. Production URL serves `/login` without a 500 error
  2. A user signs in and is assigned exactly one of SCM / Accounts / Finance / Admin / Warehouse / Logistics, with pages and actions gated by that role (WAREHOUSE + LOGISTICS roles exist + are assignable in Phase 1; their dedicated workspaces + data grants land in Phase 4)
  3. Admin can create users and assign or change roles
  4. Shopee/marketplace sync and legacy forecasting/optimizer/scheduler code no longer ship in the app

**Plans**: 1/3 complete · 2 staged (await human DB push + Vercel env)

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Remove out-of-scope code (Shopee/legacy/projection) + 6 orphaned deps; green build (Wave 1) ✓ complete

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Role/cleanup DB migrations (0011 ACCOUNTS+remap+RLS, 0012 drop integration tables). ✓ applied to prod 2026-06-23 + verified (Wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md — Six-role app layer: requireRole gating, Admin user management, /login 500-hardening. ✓ deployed to prod 2026-06-23; /login HTTP 200 verified; admin invite pending in-browser UAT (Wave 3)

### Phase 2: KPI Engine & Stock Upload

**Goal**: Stand up the data backbone — schema migrations, FY helper functions, the weekly stock upload pipeline, and the SQL views that classify and aggregate KPI scores.
**Depends on**: Phase 1
**Requirements**: STK-01, STK-02, STK-03, STK-04, KPI-01, KPI-02, KPI-03, KPI-04, KPI-05, KPI-06
**Success Criteria** (what must be TRUE):

  1. SCM uploads a weekly Excel/CSV and sees new `stock_snapshots` rows — one per (product × Monday), `source='WEEKLY_UPLOAD'` — with the raw file retained in the `stock-uploads` bucket
  2. The Monday is resolved as the most-recent Monday in Asia/Kuala_Lumpur when not supplied
  3. `fy_of`, `fy_quarter_of`, `fy_label` return correct FY (Oct→Sep) values
  4. Each eligible SKU is classified OUT_OF_STOCK / OVERSTOCK / HEALTHY using `2×AMS_3mo`, with new SKUs (< 6 months, or inactive) excluded
  5. `v_weekly_kpi` returns weekly %, and monthly/quarterly/FY scores aggregate as defined

**Plans**: 3 plans

Plans:

- [ ] 02-01: Schema migration (week_start, payments, PO fields) + FY helper functions
- [ ] 02-02: Weekly stock upload UI + parser → `stock_snapshots` + `stock-uploads` audit storage
- [ ] 02-03: KPI classification + aggregation SQL views (`v_weekly_kpi` and roll-ups)

### Phase 3: KPI Dashboard

**Goal**: Make the KPI scores visible and explorable — the SCM's primary daily surface.
**Depends on**: Phase 2
**Requirements**: DASH-01, DASH-02, DASH-03
**Success Criteria** (what must be TRUE):

  1. SCM lands on `/dashboard` showing Overstock %, OOS %, and Healthy % tiles for the current FY/Quarter/Month
  2. A FY / Quarter / Month switcher displays any past period correctly
  3. A tile drills down to the list of SKUs making up that class for the selected period

**Plans**: 2 plans

Plans:

- [ ] 03-01: Dashboard KPI tiles + FY/Quarter/Month period switcher
- [ ] 03-02: Tile drill-down to SKU breakdown

### Phase 4: PO Workflow & Finance

**Goal**: Deliver the full purchase-order lifecycle with its hand-offs, Finance partial payments, document storage, Warehouse goods receipt + container tracking, and in-app notifications.
**Depends on**: Phase 3
**Requirements**: PO-01, PO-02, PO-03, PO-04, PO-05, PO-06, WHS-01, WHS-02, WHS-03, WHS-04, FIN-01, FIN-02, FIN-03, FIN-04, NTF-01
**Success Criteria** (what must be TRUE):

  1. A PO moves DRAFT → PO_APPROVED → INVOICE_RECEIVED → SHIPPED → RECEIVED with the right role acting at each stage (LOGISTICS uploads BL/K1 + sets delivery ETA → SHIPPED; WAREHOUSE marks RECEIVED)
  2. Marking RECEIVED is gated on BL + K1_FINAL uploaded AND balance == 0
  3. Finance sees POs with `balance_remaining > 0`, records partial payments (amount + slip), and the running balance + `balance_due_by` update; balance == 0 settles the PO
  4. PO/invoice/shipping/payment/receipt-proof documents land in their correct Supabase Storage buckets
  5. The relevant role is notified in-app (bell) at each hand-off, incl. WAREHOUSE on incoming ETA
  6. At arrival, WAREHOUSE records qty received + damaged/short (remark-only, no stock change) with proof upload for short/damaged; container arrived-at + unload-completed timestamps are captured and unload duration derived (one PO = one container)
  7. Finance can pay via **Bank balance** or **Banker's Acceptance**; a BA captures a term (≤120 days from the goods' arrival date) + a computed BA due date, and upcoming BA settlements are visible with their amounts + due dates (added 2026-06-23)

**Plans** (built as increments; foundation migrations 0013/0014/0015 applied to prod):

Plans:

- [x] 04A: PO state machine + per-stage role-gated UIs (SCM draft → ACCOUNTS approve → SCM invoice → LOGISTICS ship → WAREHOUSE receive), stepper, document storage, RECEIVED gate (BL+K1+balance==0) — ✓ shipped to prod 2026-06-23
- [ ] 04B: Finance — inbox (balance > 0), record payment (**Bank balance / Banker's Acceptance**, BA term + due date), running balance (v_po_balance), amount-paid / to-be-paid / **BA-due calendar** + upcoming-BA list — 🔨 building (unblocks the RECEIVED gate once balances clear)
- [ ] 04C: Logistics clearance detail + Warehouse goods-receipt qty/damage/proof + container arrival/unload tracking + **Warehouse arrival calendar** (WHS-01..04)
- [ ] 04D: In-app notification bell for hand-offs (incl. WAREHOUSE incoming-ETA) (NTF-01)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Roles | 3/3 | Deployed (UAT pending) | 2026-06-23 |
| 2. KPI Engine & Stock Upload | 0/3 | Not started | - |
| 3. KPI Dashboard | 0/2 | Not started | - |
| 4. PO Workflow & Finance | 0/4 | Not started | - |
