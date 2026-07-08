---
phase: quick
plan: 260708-f3z
subsystem: products
tags: [sku-mappings, scm, admin, ui]
status: complete
key-files:
  created:
    - src/app/(authed)/products/sku-codes/actions.ts
    - src/app/(authed)/products/sku-codes/page.tsx
    - src/app/(authed)/products/sku-codes/sku-codes-manager.tsx
  modified:
    - src/app/(authed)/products/page.tsx
metrics:
  duration: ~15m
  completed: 2026-07-08
---

# Quick Task 260708-f3z: SKU Codes manager (variant→main mapping with conversion factor) Summary

SCM/ADMIN UI at `/products/sku-codes` to map alternate SKU codes to a main product with a
fractional conversion factor stored in the existing `sku_mappings` table — the same factor
both importers already consume to convert file quantities into main-SKU units.

## What was built

- **`actions.ts`** (`"use server"`): `createSkuMapping`, `updateSkuMapping`, `deleteSkuMapping`.
  Each calls `requireRole("SCM","ADMIN")` then writes via `createAdminClient()` (matches
  products/settings/suppliers action pattern). Stores `variant_sku` UPPERCASED+trimmed,
  `main_product_id`, `units_per_variant` (numeric, fractional allowed), optional `variant_name`/`notes`.
  Validates variant_sku non-empty, main product chosen, factor > 0. Create rejects a
  case-insensitive duplicate `variant_sku` with a clear "already mapped" error; update guards
  against colliding with a different mapping. `revalidatePath("/products/sku-codes")`.
- **`page.tsx`** (server, `requireRole("SCM","ADMIN")`): fetches all products
  (id, sku, name, product_family, is_active) and all `sku_mappings` joined to the main
  product (`main_product_id → products(sku,name)`). Header "SKU Codes" + subtitle explaining
  file codes → main SKU with auto-conversion on import.
- **`sku-codes-manager.tsx`** (client):
  - Add form — main-product `<select>` (shows `sku — name`), variant-code input, and a ratio
    input rendered `[X] of this code = [Y] main unit(s)` (default 1/1) with live `→ factor Y/X`
    (e.g. 6/1 → factor 0.1667... shown as 6-of-this=1-main); optional variant name + notes.
    Submits `units_per_variant = Y/X`.
  - List grouped by main product (main SKU + name header); each row shows the code, the stored
    factor, and a plain-language ratio ("6 of this = 1 main" or "1 of this = N main"), plus
    inline Edit (change code / main / factor / name / notes) and Delete (confirm).
  - Styling matches existing Card/Button/plain-input patterns; `router.refresh()` after writes.
- **`products/page.tsx`**: added "Manage SKU codes" header link, gated to `canManage` (SCM/ADMIN),
  linking to `/products/sku-codes`.

## Verification

- `npm run build` exits 0 (confirmed twice). Route `/products/sku-codes` registered as a
  dynamic (ƒ) route in the build output. TypeScript compiled clean.

## Deviations from Plan

None — plan executed as written. Auth mirrors the `requireRole` + `createAdminClient` pattern
specified; Supabase join normalized with an `any`-cast (object-or-array) per the codebase convention.

## Constraints honored

- No new npm dependencies.
- No schema / `.sql` / migration / `.planning/` code changes (only this quick-task's own docs).
- Every entry point (page + all three actions) gated strictly to SCM/ADMIN.

## Self-Check: PASSED
- src/app/(authed)/products/sku-codes/actions.ts — FOUND
- src/app/(authed)/products/sku-codes/page.tsx — FOUND
- src/app/(authed)/products/sku-codes/sku-codes-manager.tsx — FOUND
- src/app/(authed)/products/page.tsx — FOUND (modified)
- Commit 419ade1 — FOUND
