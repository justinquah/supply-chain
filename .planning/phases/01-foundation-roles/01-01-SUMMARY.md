---
phase: 01-foundation-roles
plan: "01"
subsystem: codebase-cleanup
tags: [cleanup, dependency-removal, shopee, legacy, prisma]
status: complete

dependency_graph:
  requires: []
  provides:
    - clean-codebase-without-shopee-legacy-prisma
    - shopee-free-settings-stub
    - trimmed-package-json
  affects:
    - src/app/(authed)/settings/page.tsx
    - src/app/(authed)/settings/actions.ts
    - src/components/nav-bar.tsx
    - src/app/(authed)/stock/actions.ts
    - src/app/(authed)/stock/page.tsx
    - src/app/(authed)/dashboard/page.tsx
    - package.json
    - package-lock.json

tech_stack:
  added: []
  patterns:
    - Deleted unused directories via git rm (git history preserved)
    - npm uninstall for orphaned dependency removal
    - Shopee-free server component stub for Settings page

key_files:
  created: []
  modified:
    - src/app/(authed)/settings/page.tsx
    - src/app/(authed)/settings/actions.ts
    - src/components/nav-bar.tsx
    - src/app/(authed)/stock/actions.ts
    - src/app/(authed)/stock/page.tsx
    - src/app/(authed)/dashboard/page.tsx
    - package.json
    - package-lock.json
  deleted:
    - src/_legacy/ (93 files)
    - src/app/api/shopee/ (auth + callback routes)
    - src/app/(authed)/projection/page.tsx
    - src/lib/shopee.ts
    - src/app/(authed)/settings/sync-button.tsx
    - src/components/layout/sidebar.tsx
    - prisma/ (schema, migrations, seed, dev.db artifacts)
    - shopee-submission/ (empty directory)

decisions:
  - Deleted sidebar.tsx entirely (superseded by NavBar; sole non-legacy next-auth importer) — no port needed, D-09 confirmed
  - Removed @types/bcryptjs alongside bcryptjs (devDependency type stubs for a removed package)
  - Removed prisma/dev.db and dev.db-journal (untracked binary artifacts) with rm -rf alongside git rm of tracked prisma files

metrics:
  duration_minutes: 4
  completed_date: "2026-06-22"
  tasks_completed: 3
  tasks_total: 3
  files_changed: 120
---

# Phase 01 Plan 01: Deck-Clearing (Remove Legacy/Shopee/Prisma) Summary

**One-liner:** Deleted 108 tracked files (src/_legacy, api/shopee, projection, sidebar, prisma, shopee-submission), rewrote Settings to a Shopee-free stub, purged 7 orphaned npm packages, and confirmed `npm run build` exits 0 with 13 clean routes.

## What Was Built

This plan cleared all out-of-scope code and orphaned dependencies from the brownfield codebase, leaving a clean, building foundation for the DB migration (01-02) and role-model work (01-03).

**Satisfies:**
- FND-01: All Shopee/marketplace sync code removed from the app (api/shopee routes, lib/shopee.ts, sync-button.tsx, syncShopeeStock action, @/lib/shopee imports)
- FND-02: Legacy demand-forecasting / container-optimizer / payment-scheduler tree (src/_legacy/) and the demand projection page deleted

## Task Results

| Task | Name | Commit | Key Changes |
|------|------|--------|-------------|
| 1 | Delete legacy dirs + sidebar.tsx | c5a3cec | 108 files deleted: _legacy/, api/shopee/, projection/, shopee.ts, sync-button.tsx, sidebar.tsx, prisma/, shopee-submission/ |
| 2 | Rewrite Settings stub + purge Shopee refs | f181d61 | settings/page.tsx, settings/actions.ts rewritten; nav-bar /projection removed; stock/actions.ts projection revalidate removed; copy text updated |
| 3 | Remove orphaned deps + green build | bea7e14 | npm uninstall 7 packages (43 removed total); npm run build exits 0 |

## Verification Results

All acceptance criteria met:
- `grep -rl "next-auth|@/lib/shopee|@prisma|@libsql|bcryptjs" src` returns no matches
- All deleted paths confirmed absent
- `npm run build` exits 0 — 13 routes (static + dynamic), no module-resolution errors
- Locked stack (@supabase/supabase-js, @supabase/ssr, next, react, zod, xlsx) remains intact

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Prisma untracked binary artifacts required manual removal**
- **Found during:** Task 1
- **Issue:** `prisma/dev.db` and `prisma/dev.db-journal` were untracked binary files (not in git), so `git rm -r prisma/` removed only the tracked SQL/TypeScript files, leaving the directory present and causing the Task 1 acceptance check to fail.
- **Fix:** `rm -rf prisma/dev.db prisma/dev.db-journal && rmdir prisma` — deleted untracked binary artifacts and the now-empty directory.
- **Files modified:** prisma/ directory (physical removal)
- **Impact:** Zero; these were SQLite development artifacts that should never have been in the repo untracked.

No other deviations — plan executed as written.

## Known Stubs

`src/app/(authed)/settings/page.tsx` contains a placeholder section for user/role management. This is **intentional** — plan 01-03 adds the Admin user-management UI (UsersTable, inviteUser, updateUserRole) to this exact file. The stub does not prevent the plan's goal (Shopee-free Settings page) from being achieved.

## Threat Flags

None. This plan performs deletion and cleanup only — no new network endpoints, auth paths, file access patterns, or schema changes were introduced.

## Self-Check: PASSED

Files verified:
- FOUND: src/app/(authed)/settings/page.tsx
- FOUND: src/app/(authed)/settings/actions.ts
- FOUND: src/components/nav-bar.tsx
- FOUND: package.json

Commits verified:
- FOUND: c5a3cec (Task 1)
- FOUND: f181d61 (Task 2)
- FOUND: bea7e14 (Task 3)

Build: npm run build exits 0 (verified during Task 3 execution)
