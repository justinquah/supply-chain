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

**Goal**: Remove all out-of-scope code, establish exactly four role-gated identities, and ensure production serves login cleanly — a clean base for the KPI and PO work.
**Depends on**: Nothing (first phase)
**Requirements**: FND-01, FND-02, FND-03, AUTH-01, AUTH-02, AUTH-03
**Success Criteria** (what must be TRUE):

  1. Production URL serves `/login` without a 500 error
  2. A user signs in and is assigned exactly one of SCM / Accounts / Finance / Admin, with pages and actions gated by that role
  3. Admin can create users and assign or change roles
  4. Shopee/marketplace sync and legacy forecasting/optimizer/scheduler code no longer ship in the app

**Plans**: 1/3 plans executed

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Remove out-of-scope code (Shopee/legacy/projection) + 6 orphaned deps; green build (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 01-02-PLAN.md — Role/cleanup DB migrations (0011 ACCOUNTS+remap+RLS, 0012 drop integration tables) + supabase db push (Wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 01-03-PLAN.md — Four-role app layer: requireRole gating, Admin user management, /login 500-hardening (Wave 3)

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

**Goal**: Deliver the full purchase-order lifecycle with its hand-offs, Finance partial payments, document storage, and in-app notifications.
**Depends on**: Phase 3
**Requirements**: PO-01, PO-02, PO-03, PO-04, PO-05, PO-06, FIN-01, FIN-02, FIN-03, FIN-04, NTF-01
**Success Criteria** (what must be TRUE):

  1. A PO moves DRAFT → PO_APPROVED → INVOICE_RECEIVED → SHIPPED → RECEIVED with the right role acting at each stage
  2. Marking RECEIVED is gated on BL + K1_FINAL uploaded AND balance == 0
  3. Finance sees POs with `balance_remaining > 0`, records partial payments (amount + slip), and the running balance + `balance_due_by` update; balance == 0 settles the PO
  4. PO/invoice/shipping/payment documents land in their correct Supabase Storage buckets
  5. The relevant role is notified in-app (bell) at each hand-off

**Plans**: 3 plans

Plans:

- [ ] 04-01: PO state machine + per-stage UIs (draft, approve, invoice, ship, receive) + document storage
- [ ] 04-02: Finance inbox + partial payments + running balance / balance_due_by
- [ ] 04-03: In-app notification bell for hand-offs

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Roles | 1/3 | In Progress|  |
| 2. KPI Engine & Stock Upload | 0/3 | Not started | - |
| 3. KPI Dashboard | 0/2 | Not started | - |
| 4. PO Workflow & Finance | 0/3 | Not started | - |
