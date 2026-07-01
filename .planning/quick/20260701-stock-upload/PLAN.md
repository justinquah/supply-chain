---
type: quick
slug: stock-upload
created: 2026-07-01
---

# Quick Task: In-app Stock Upload

Add an Excel/CSV file upload to the Stock Levels page so SCM can upload weekly
stock (sku + quantity) instead of typing each product manually.

## Scope

- New client component `stock-upload-form.tsx` in `src/app/(authed)/stock/`
  with a snapshot-date input + file input, mirroring the `sales-upload-form.tsx`
  style (client component calling a server action, displaying a result message).
- New export `importStock(formData: FormData)` in
  `src/app/(authed)/stock/actions.ts`:
  - `requireRole("SCM", "ADMIN")` (via `getCurrentUser` + manual role check).
  - Parse the uploaded `.xlsx`/`.xls`/`.csv` File (via `arrayBuffer()` +
    `XLSX.read`), reading the first sheet to JSON.
  - Flexible header matching for SKU (`sku`/`System Product Code`/`Item Code`)
    and quantity (`quantity`/`qty`/`stock`), plus an optional per-row date
    column (`week_start`/`date`).
  - Build SKU resolution map from `products` + `sku_mappings` tables (same
    precedence as the sales upload: direct product match wins over mapping).
  - Sum duplicate rows per resolved product; per-(product, date) idempotent
    write — deletes existing `WEEKLY_UPLOAD` snapshots for the snapshot date
    before inserting.
  - Collect unresolved SKUs without inserting them; return them in the result.
- Wire `StockUploadForm` into `src/app/(authed)/stock/page.tsx` above the
  existing manual grid (both remain available).
- No schema changes (the `WEEKLY_UPLOAD` stock_source value already exists
  per `supabase/migrations/0018_stock_weekly_upload.sql`). No new npm deps
  (`xlsx` was already a dependency).

## Constraints

- App-code only.
- `npm run build` exits 0.
- Atomic commit(s), matching existing code style.
