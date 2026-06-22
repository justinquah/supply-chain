# JJANGX3 Supply Chain

## What This Is

An internal web app that moves JJANGX3's supply chain off spreadsheets onto one system. It does three things: (1) scores how well stock is managed via Overstock % / OOS % KPIs across month/quarter/FY, (2) tracks every purchase order through its hand-offs (SCM → Accounts → SCM → Finance → SCM), and (3) goes live 1 July 2026. Users are four internal roles: SCM, Accounts, Finance, Admin.

## Core Value

The SCM signs in and sees trustworthy Overstock % and OOS % KPI tiles for the current FY/Quarter/Month, driven by weekly stock uploads — and every PO is traceable end-to-end through its hand-offs. If everything else fails, the KPI dashboard and the PO workflow must work.

## Business Context

- **Customer**: JJANGX3 internal supply chain team (SCM owns the KPI).
- **Revenue model**: Internal tool — no direct revenue; value is inventory efficiency (less overstock, fewer stock-outs) and audit-ready PO tracking.
- **Success metric**: A non-empty `v_weekly_kpi` row produced from the first real weekly upload (Mon 7 Jul 2026); first KPI month closes 31 Jul 2026.
- **Strategy notes**: See `REQUIREMENTS-draft.md` (locked brief, dated 2026-06-22).

## Requirements

### Validated

<!-- Already shipped in the repo (recent Supabase rebuild). -->

- ✓ Supabase backend (Postgres + Auth + Storage) wired into a Next.js app — existing
- ✓ Qianyi online-sales importer — existing (monthly online sales)
- ✓ AutoCount offline-sales importer — existing (monthly offline sales)
- ✓ Products page (SKU / Barcode / Brand / Series) — existing
- ✓ Inventory dashboard + PO/invoice register scaffolding — existing

### Active

<!-- Locked scope for the 1 Jul 2026 go-live. Hypotheses until shipped + validated. -->

- [ ] Four-role auth model (SCM, Accounts, Finance, Admin) with role-gated access
- [ ] Weekly stock upload (Excel/CSV → `stock_snapshots`, one row per product × Monday, `source='WEEKLY_UPLOAD'`)
- [ ] KPI engine: Overstock % / OOS % / Healthy % per weekly snapshot, with 6-month SKU incubation eligibility
- [ ] KPI aggregation: weekly → monthly (avg of Mondays) → quarterly (avg of 3 months) → FY (avg of 12 months)
- [ ] FY helpers (Oct→Sep): `fy_of`, `fy_quarter_of`, `fy_label`
- [ ] Dashboard with Overstock % + OOS % tiles and FY/Quarter/Month switcher + drill-down
- [ ] PO workflow through all states: DRAFT → PO_APPROVED → INVOICE_RECEIVED → (payments) → SHIPPED → RECEIVED
- [ ] Finance inbox: POs with `balance_remaining > 0`, partial payments (amount + slip), running balance + balance_due_by
- [ ] Document storage in Supabase Storage buckets (po-pdfs, invoices, shipping-docs, payment-slips, stock-uploads)
- [ ] RECEIVED gate: requires BL + K1_FINAL uploaded AND balance == 0
- [ ] In-app notification bell (no email/SMS/WhatsApp at go-live)

### Out of Scope

- Shopee / Lazada / TikTok Shop API integrations — removed from scope; existing Shopee sync to be stripped
- Email / SMS / WhatsApp notifications — in-app bell only at go-live
- Demand forecasting, container optimizer, payment scheduler — legacy code, will be deleted
- Multi-warehouse / multi-location stock — one SKU = one stock figure
- Supplier portal access — suppliers operate off-app

## Context

- Brownfield: a recent "Rebuild on Supabase" commit already delivered inventory dashboard, KPIs scaffolding, PO/invoice register, and a (now out-of-scope) Shopee sync. M0 includes stripping Shopee and simplifying roles down to the final four.
- Data cadence: stock weekly (Monday upload), online + offline sales monthly (existing importers), POs per transaction.
- KPI definition is LOCKED (see REQUIREMENTS-draft.md): `OUT_OF_STOCK = stock==0`, `OVERSTOCK = stock > 2×AMS_3mo`, `HEALTHY = 0 < stock ≤ 2×AMS_3mo`; `AMS_3mo` = avg monthly sales (online+offline) over past 3 calendar months. Eligibility: `created_at ≤ snapshot_date − 6 months AND is_active`.
- All "most recent Monday" / snapshot dates computed in Asia/Kuala_Lumpur.
- Aggressive 9-day path (M0 Mon 23 Jun → Go-live Wed 1 Jul). First KPI-bearing upload is Mon 7 Jul; dry run Mon 30 Jun mitigates first-week parser risk.

## Constraints

- **Tech stack**: Next.js 16 + Turbopack, React 19, Supabase (Postgres + Auth + Storage), shadcn/ui, Tailwind 4 — **no new top-level dependencies without explicit approval**.
- **Roles**: exactly four (SCM, Accounts, Finance, Admin). No more.
- **Currency**: MYR.
- **Timezone**: Asia/Kuala_Lumpur — all Monday/snapshot computation in this TZ.
- **Financial Year**: Oct → Sep (FY25/26 = 1 Oct 2025 – 30 Sep 2026).
- **Timeline**: Go-live 1 Jul 2026; 9-day build window. Every day of Vercel-env delay compresses the rest.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Drop marketplace API sync (Shopee/Lazada/TikTok) | Out of scope; reduces surface for go-live | — Pending (strip in M0) |
| Exactly 4 roles | Matches real org responsibilities; simplifies auth | — Pending |
| KPI = Overstock % + OOS % + Healthy %, 2×AMS_3mo threshold | Locked business definition | — Pending |
| 6-month SKU incubation before KPI eligibility | New SKUs shouldn't penalize stock-management score | — Pending |
| FY Oct→Sep with Postgres helper functions | Business fiscal calendar | — Pending |
| In-app bell only (no email/SMS) at go-live | Scope control for tight timeline | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-22 after initialization*
