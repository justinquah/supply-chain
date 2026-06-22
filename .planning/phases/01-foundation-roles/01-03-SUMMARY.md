---
phase: 01-foundation-roles
plan: "03"
subsystem: auth
tags: [roles, requireRole, admin-client, server-actions, supabase, env-hardening]
dependency_graph:
  requires:
    - phase: "01-02"
      provides: "user_role enum with ACCOUNTS, deprecated roles remapped, RLS rebuilt"
  provides:
    - requireRole() server helper gating pages and actions to the four canonical roles
    - createAdminClient() service-role client (server-only)
    - Admin user-management screen (list, invite, change role)
    - env-var guard in createClient() (client.ts + server.ts) preventing /login 500
    - Corrected app-layer role enum/constants/labels (SCM, ACCOUNTS, FINANCE, ADMIN)
    - .env.example updated with the three Supabase env vars
  affects:
    - phase-02-kpi (stock page now gated SCM/ADMIN only)
    - phase-04-po-workflow (PO canWrite now uses four canonical roles; supplier dropdown uses company_name)
tech-stack:
  added: []
  patterns:
    - requireRole(...roles) server helper — redirect-to-login pattern for Server Components
    - createAdminClient() service-role pattern — server-only, never client-imported
    - Server actions import admin.ts, client components never do
    - appRoleSchema (zod) used server-side to validate role values before DB writes
key-files:
  created:
    - src/lib/supabase/admin.ts
    - src/app/(authed)/settings/users-table.tsx
  modified:
    - src/lib/supabase/server.ts
    - src/lib/supabase/client.ts
    - src/types/index.ts
    - src/lib/constants.ts
    - src/app/(authed)/layout.tsx
    - src/app/(authed)/settings/page.tsx
    - src/app/(authed)/settings/actions.ts
    - src/app/(authed)/stock/page.tsx
    - src/app/(authed)/stock/actions.ts
    - src/app/(authed)/purchase-orders/page.tsx
    - src/app/(authed)/purchase-orders/actions.ts
    - .env.example
key-decisions:
  - "D-06: requireRole() added to server.ts, used in stock/page.tsx and settings/page.tsx + actions.ts"
  - "D-08: Admin user-management via inviteUserByEmail with role in metadata; updateUserRole via admin client"
  - "D-12: createClient() in client.ts and server.ts throws clear config error when NEXT_PUBLIC_SUPABASE_URL or ANON_KEY missing"
  - "SUPPLIER dropdown: replaced .eq(role,SUPPLIER) with .not(company_name,is,null) — Phase 4 redesigns PO supplier model"
  - "stock/page.tsx: requireRole(SCM,ADMIN) at page top — ACCOUNTS/FINANCE redirected to /login for stock edits"
patterns-established:
  - "requireRole(...roles): import from @/lib/supabase/server in Server Components/Actions; for actions returning {ok,error} use getCurrentUser() + manual role check instead"
  - "admin.ts: server-only service-role client; import only in 'use server' actions, never in 'use client' components"
  - "appRoleSchema: always validate role strings server-side before any DB/Admin API write to prevent privilege escalation"
requirements-completed: [AUTH-02, AUTH-03, FND-03]
duration: ~30min
completed: "2026-06-22"
status: complete
---

# Phase 1 Plan 03: App-Layer Role Enforcement Summary

**requireRole() + createAdminClient() + Admin user-management screen wired to Supabase Admin API; four-role enum/constants corrected; env-var guards prevent /login 500.**

---

## Performance

- **Duration:** ~30 min
- **Started:** 2026-06-22
- **Completed:** 2026-06-22
- **Tasks:** 3 (of 4 — Task 4 is pending human action)
- **Files created:** 2 (admin.ts, users-table.tsx)
- **Files modified:** 11

---

## Accomplishments

- `requireRole(...roles)` helper added to server.ts; used in settings/page.tsx (ADMIN gate) and stock/page.tsx (SCM/ADMIN gate)
- `createAdminClient()` created as server-only service-role client; imported only from "use server" actions
- Admin Settings screen: user list with per-row role change select + invite form — both wired to server actions that call `inviteUserByEmail` and update `profiles.role`
- `createClient()` in client.ts and server.ts now throws a descriptive error (naming the missing env var) instead of passing `undefined` into the Supabase factory — closes the /login 500 risk
- App-layer role enum (zod), ROLES, ROLE_LABELS constants, and the layout ROLE_LABELS map all corrected to the four canonical roles: SCM, ACCOUNTS, FINANCE, ADMIN
- SUPPLIER dropdown in purchase-orders/page.tsx fixed: replaced `.eq("role","SUPPLIER")` with `.not("company_name","is",null)` — SUPPLIER role no longer exists after migration 0011
- `.env.example` replaced legacy SQLite/Shopee/NextAuth vars with the three Supabase vars

---

## Task Commits

1. **Task 1: requireRole + admin client + env guards + enum/constants fixes** — `b13d618` (feat)
2. **Task 2: Refactor role gating; SUPPLIER dropdown fix** — `031396a` (feat)
3. **Task 3: Admin user-management screen** — `c9d337e` (feat)

---

## Files Created/Modified

- `src/lib/supabase/server.ts` — Added `AppRole` type, `requireRole(...roles)`, env-var guard in `createClient()`
- `src/lib/supabase/client.ts` — Env-var guard in `createClient()` (replaces `!` assertion)
- `src/lib/supabase/admin.ts` — NEW: `createAdminClient()` service-role client (server-only)
- `src/types/index.ts` — `appRoleSchema` exported; role enums fixed to SCM/ACCOUNTS/FINANCE/ADMIN
- `src/lib/constants.ts` — `ROLES` and `ROLE_LABELS` updated to four canonical roles
- `src/app/(authed)/layout.tsx` — ROLE_LABELS map trimmed to four canonical roles
- `src/app/(authed)/settings/page.tsx` — requireRole("ADMIN") gate; loads user list; renders UsersTable
- `src/app/(authed)/settings/actions.ts` — `inviteUser()` and `updateUserRole()` server actions
- `src/app/(authed)/settings/users-table.tsx` — NEW: "use client" user list + invite form
- `src/app/(authed)/stock/page.tsx` — `requireRole("SCM","ADMIN")` replaces inline SUPER_ADMIN array
- `src/app/(authed)/stock/actions.ts` — Role check updated to `["SCM","ADMIN"]`
- `src/app/(authed)/purchase-orders/page.tsx` — CAN_WRITE updated; SUPPLIER dropdown fixed
- `src/app/(authed)/purchase-orders/actions.ts` — CAN_WRITE updated to four-role set
- `.env.example` — Replaced legacy vars with NEXT_PUBLIC_SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY

---

## Decisions Made

- **SUPPLIER dropdown approach:** `.not("company_name","is","null")` populates supplier options from any profile with a company name. This is a Phase-1 substitute noted with a TODO comment. Phase 4 redesigns the PO supplier model per the brief.
- **stock/page.tsx gating:** `requireRole("SCM","ADMIN")` at the top gates stock level editing — ACCOUNTS and FINANCE are redirected. The KPI dashboard (Phase 2) will be their primary read path.
- **admin client in actions only:** `createAdminClient()` is imported only in `settings/actions.ts`. The `users-table.tsx` client component imports only the server actions, satisfying the T-01-06 threat mitigation.
- **role validation on write:** Both `inviteUser` and `updateUserRole` parse the role through `appRoleSchema.safeParse()` before touching the DB or Admin API, preventing privilege escalation (T-01-07).

---

## Deviations from Plan

### Minor Scope Extension

**doc-badge.tsx contains `LOGISTICS_INVOICE` (a document type constant, not a role)**
- **Found during:** Task 2 acceptance criteria check
- **Assessment:** `LOGISTICS_INVOICE` is a document category label in `BUCKET`/`LABEL` maps — it is NOT a role reference. The plan acceptance criteria grep for `LOGISTICS` matches it as a false positive. The file was not modified since it contains no role gating.
- **Impact:** The automated acceptance criteria grep for `LOGISTICS` in purchase-orders returns one hit (doc-badge.tsx line 13: `LOGISTICS_INVOICE: "LOG-INV"`). This is a pre-existing document type name, not a deprecated role. No action required.

None beyond this false positive. All code changes executed exactly as specified in the plan.

---

## Known Stubs

None — the Admin user-management screen is fully wired: user list loads from the profiles table, invite calls `auth.admin.inviteUserByEmail`, and role change updates `profiles.role`. No placeholder data flows to the UI.

---

## Threat Flags

No new security surface introduced beyond what the plan's threat register covers. Mitigations applied:

| Threat | Mitigation Applied |
|--------|--------------------|
| T-01-06: SERVICE_ROLE_KEY client leak | admin.ts is server-only; users-table.tsx has 0 imports of @/lib/supabase/admin (verified by grep) |
| T-01-07: Role escalation via crafted input | appRoleSchema.safeParse() in both actions before any write |
| T-01-08: /login 500 on missing env var | createClient() in both client.ts and server.ts throw clear config errors |

---

## ⏸ PENDING HUMAN ACTION — Production Deployment Required

**Status:** All app-layer code has been written and committed. Production deployment and live verification are blocked on human steps.

### Required steps (in order)

**(a) Apply database migrations (prerequisite from plan 01-02)**

The migration files were committed in plan 01-02 but have NOT been applied to the live Supabase database.

```bash
# Option A: CLI
supabase link   # if not already linked
supabase db push

# Option B: Supabase Dashboard -> SQL Editor
# Run: supabase/migrations/0011_role_cleanup.sql
# Run: supabase/migrations/0012_drop_integration_tokens.sql
```

Verification queries after applying:
```sql
SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'user_role' AND e.enumlabel = 'ACCOUNTS'; -- expect: 1 row

SELECT count(*) FROM public.profiles
WHERE role IN ('SUPER_ADMIN','GENERAL','LOGISTICS','WAREHOUSE','SUPPLIER'); -- expect: 0
```

**(b) Set Vercel environment variables**

In Vercel Dashboard -> Project -> Settings -> Environment Variables (Production):

| Variable | Source |
|----------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard -> Project Settings -> API -> Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard -> Project Settings -> API -> anon (public) key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard -> Project Settings -> API -> service_role key (SECRET — never prefix NEXT_PUBLIC_) |

After setting, redeploy the project.

**(c) Verify production /login + Admin invite/role-change**

1. Visit the production /login URL — must render the login form with NO 500 error (FND-03)
2. Sign in as an ADMIN user. Open /settings — confirm the user list renders
3. Invite a test user with role = ACCOUNTS; confirm the action reports success
4. Change an existing user's role via the per-row select; confirm it persists on reload
5. Sign in as a non-ADMIN (e.g. SCM) and confirm /settings redirects to /login

**Plan 01-03 is NOT fully complete until all three steps above succeed in production.**

---

## Self-Check

### Files exist

- src/lib/supabase/admin.ts: FOUND
- src/app/(authed)/settings/users-table.tsx: FOUND
- src/app/(authed)/settings/actions.ts: FOUND (modified)
- src/app/(authed)/settings/page.tsx: FOUND (modified)

### Commits exist

- b13d618 (Task 1): feat(01-03): add requireRole(), createAdminClient(), env guards
- 031396a (Task 2): feat(01-03): refactor role gating; fix SUPPLIER dropdown
- c9d337e (Task 3): feat(01-03): Admin user-management screen

### Build

`npm run build` exits 0 — TypeScript clean, all pages compile.

## Self-Check: PASSED
