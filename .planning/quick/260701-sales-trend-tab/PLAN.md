---
type: quick
slug: sales-trend-tab
date: 2026-07-01
---

# Quick Task: Sales Trend tab

Add a "Sales Trend" tab: a table of products (grouped by range → variation)
with one column per month showing units sold, and a Total / Online / Offline
toggle.

## Scope

- New route `src/app/(authed)/sales/trend/page.tsx`, gated with
  `requireRole('SCM','ACCOUNTS','FINANCE','ADMIN')`.
- New client component `src/components/sales-trend-table.tsx` mirroring the
  range → variation expand/collapse pattern from `grouped-inventory.tsx`.
- Nav link "Sales Trend" in `nav-bar.tsx`, scoped to the same 4 roles, placed
  next to "Sales".
- Server page queries all `monthly_sales` joined to `products`, pivots into
  product × month × channel, passes to the client table component.
- Channel toggle (Total | Online | Offline) via `?c=` query param, default
  total.
- No schema changes, no new deps.

## Tasks

1. Build `SalesTrendTable` client component (props: grouped product rows with
   per-month units, month column list, selected channel).
2. Build `src/app/(authed)/sales/trend/page.tsx` server component: auth gate,
   query, pivot logic, channel toggle links, render table.
3. Add nav link in `nav-bar.tsx`.
4. `npm run build` — fix any type errors.
5. Write SUMMARY.md, commit.

## Verification

- `npm run build` exits 0.
- Manual review of pivot logic (product × month × channel aggregation).
