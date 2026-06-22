# Requirements: JJANGX3 Supply Chain

**Defined:** 2026-06-22
**Core Value:** SCM sees trustworthy Overstock %/OOS % KPI tiles for the current FY/Quarter/Month, and every PO is traceable end-to-end through its hand-offs.

## v1 Requirements

Requirements for the 1 July 2026 go-live. Each maps to a roadmap phase.

### Foundation

- [ ] **FND-01**: Existing Shopee/marketplace API sync code is removed from the app
- [ ] **FND-02**: Legacy demand-forecasting / container-optimizer / payment-scheduler code is deleted
- [ ] **FND-03**: Production deploys serve `/login` without a 500 error

### Auth & Roles

- [ ] **AUTH-01**: A user can sign in and is assigned exactly one of four roles (SCM, Accounts, Finance, Admin)
- [ ] **AUTH-02**: Access to pages and actions is gated by role (SCM, Accounts, Finance, Admin scopes per the brief)
- [ ] **AUTH-03**: Admin can manage users and assign/change roles

### Stock Upload

- [ ] **STK-01**: SCM can upload a weekly stock Excel/CSV with columns `sku, quantity, [week_start]`
- [ ] **STK-02**: Upload produces one `stock_snapshots` row per (product × Monday) with `source='WEEKLY_UPLOAD'`
- [ ] **STK-03**: The Monday (`week_start`) is resolved as the most-recent Monday in Asia/Kuala_Lumpur when not supplied
- [ ] **STK-04**: The raw uploaded file is retained in the `stock-uploads` bucket as an audit trail

### KPI Engine

- [ ] **KPI-01**: Postgres FY helpers `fy_of(date)`, `fy_quarter_of(date)`, `fy_label(date)` exist (FY runs Oct→Sep)
- [ ] **KPI-02**: Per snapshot, each eligible SKU is classified OUT_OF_STOCK (stock==0), OVERSTOCK (stock > 2×AMS_3mo), or HEALTHY (0 < stock ≤ 2×AMS_3mo)
- [ ] **KPI-03**: `AMS_3mo` is computed as average monthly sales (online + offline summed) over the past 3 calendar months
- [ ] **KPI-04**: SKU eligibility = `created_at ≤ snapshot_date − 6 months AND is_active`; ineligible SKUs are excluded from KPI
- [ ] **KPI-05**: Weekly % = count(class) / count(eligible) for that Monday, exposed via a weekly KPI view (e.g. `v_weekly_kpi`)
- [ ] **KPI-06**: Monthly score = average of weekly % across that month's Mondays; quarterly = avg of 3 monthly; FY = avg of 12 monthly

### Dashboard

- [ ] **DASH-01**: SCM lands on `/dashboard` showing Overstock %, OOS %, and Healthy % tiles for the current FY/Quarter/Month
- [ ] **DASH-02**: A FY / Quarter / Month switcher lets the user view any past period
- [ ] **DASH-03**: A tile can be drilled down to the SKUs that make up that class for the selected period

### Purchase Orders

- [ ] **PO-01**: SCM can draft a PO (supplier, product range, expected_invoice_amount, deposit_pct, payment_terms) → state DRAFT
- [ ] **PO-02**: Accounts can upload the signed PO PDF, set `po_number` and `targeted_eta` → state PO_APPROVED
- [ ] **PO-03**: SCM can upload the supplier invoice file and key `invoice_amount` + `invoice_number` and confirm payment_terms → state INVOICE_RECEIVED
- [ ] **PO-04**: SCM can upload BL and K1_FINAL and set `actual_eta` → state SHIPPED
- [ ] **PO-05**: SCM can mark a PO RECEIVED, gated on BL + K1_FINAL uploaded AND balance == 0
- [ ] **PO-06**: PO documents are stored in the correct buckets (po-pdfs, invoices, shipping-docs)

### Finance

- [ ] **FIN-01**: Finance sees POs with `balance_remaining > 0` in an inbox/register
- [ ] **FIN-02**: Finance can record a payment (amount + slip upload) and may repeat for partial payments
- [ ] **FIN-03**: The system shows a running balance and `balance_due_by`; balance == 0 marks the PO settled
- [ ] **FIN-04**: Payment slips are stored in the `payment-slips` bucket; SCM can download them

### Notifications

- [ ] **NTF-01**: Relevant role is notified in-app (bell) at each hand-off (Accounts on DRAFT, Finance when balance_remaining > 0)

## v2 Requirements

Deferred — acknowledged but not in the go-live roadmap.

### Notifications

- **NTF-02**: Email / SMS / WhatsApp delivery of hand-off notifications

## Out of Scope

| Feature | Reason |
|---------|--------|
| Shopee / Lazada / TikTok Shop API integrations | Removed from scope; existing Shopee sync to be stripped |
| Email / SMS / WhatsApp notifications | In-app bell only at go-live (see NTF-02 for future) |
| Demand forecasting, container optimizer, payment scheduler | Legacy code, will be deleted |
| Multi-warehouse / multi-location stock | One SKU = one stock figure |
| Supplier portal access | Suppliers operate off-app |

## Traceability

Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| (to be filled by roadmap) | | |

**Coverage:**
- v1 requirements: 30 total
- Mapped to phases: 0 ⚠️ (pending roadmap)
- Unmapped: 30 ⚠️

---
*Requirements defined: 2026-06-22*
*Last updated: 2026-06-22 after initial definition*
