# Phase 1: Foundation & Roles - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Clear the deck and lock identity. This phase: (1) removes all out-of-scope code (Shopee/marketplace sync, the `src/_legacy/` tree, demand projection, and their now-orphaned dependencies), (2) reduces the role model to exactly four roles (SCM, ACCOUNTS, FINANCE, ADMIN) with consistent role-gated access, (3) provides Admin user/role management, and (4) ensures production serves `/login` without a 500.

It does NOT touch KPI logic, stock upload, dashboard, or the PO/finance workflow — those are Phases 2–4. The PO `po_status` enum still carries legacy values (`PROPOSED…CANCELLED`); remapping it to `DRAFT→…→RECEIVED` is **Phase 4**, not here.
</domain>

<decisions>
## Implementation Decisions

### Role Model
- **D-01:** Final role set is exactly four: `SCM`, `ACCOUNTS`, `FINANCE`, `ADMIN`. `ACCOUNTS` does not yet exist and MUST be added to the `user_role` enum (Supabase migration `0001` currently defines 8 values: SUPER_ADMIN, SCM, GENERAL, FINANCE, ADMIN, LOGISTICS, WAREHOUSE, SUPPLIER).
- **D-02:** Migration strategy — **add** `ACCOUNTS` to the enum and treat only the four as valid at the application layer. Do not attempt to physically DROP enum values (Postgres can't drop enum members that columns/defaults may reference without a type rebuild); instead deprecate the extras. Remap any existing rows: `SUPER_ADMIN → ADMIN`; `GENERAL/LOGISTICS/WAREHOUSE/SUPPLIER → ADMIN` (or flag for manual reassignment — researcher to confirm there is real seed data; the brief implies a small fixed user set).
- **D-03:** Change the `profiles.role` default away from `'GENERAL'` — new users get an explicit role at invite time (no silent default). The `handle_new_user` trigger reads role from `raw_user_meta_data`; keep that path, drop the `GENERAL` fallback.
- **D-04:** Fix the stale app-layer enum in `src/types/index.ts` (currently `["ADMIN","FINANCE","SUPPLIER","LOGISTICS"]`) to the four canonical roles.

### Auth & Gating
- **D-05:** Auth mechanism is **Supabase Auth** (already in place: `auth.users` + `public.profiles`, `getCurrentUser()` in `src/lib/supabase/server.ts`, `(authed)/layout.tsx` redirect-to-`/login`). No new auth system. `next-auth` is to be removed (see D-09).
- **D-06:** Centralize role gating. Replace the scattered inline arrays (e.g. `["SUPER_ADMIN","SCM","ADMIN"]` in settings/stock/purchase-orders pages & actions) with a single server-side `requireRole(...roles)` helper that builds on `getCurrentUser()`. Purge all references to dead roles (SUPER_ADMIN, LOGISTICS, etc.) from these call sites.
- **D-07:** Keep the existing Postgres helpers (`current_user_role()`, `has_role()`) as RLS / defense-in-depth where policies already use them, but drop/replace `is_super_admin()` usage (SUPER_ADMIN is gone → folds into ADMIN).

### Admin User Management
- **D-08:** Provide an in-app Admin screen under `src/app/(authed)/settings` to invite users and assign/change their role in `profiles`. Use the Supabase Admin API via a **service-role server action** (server-only; never expose the service key to the client). Minimal but functional for go-live — list users, invite by email + role, change role.

### Out-of-Scope Code Removal
- **D-09:** Delete outright (git history preserves them): `src/_legacy/`, `src/app/api/shopee/`, `src/app/(authed)/projection/`, the top-level `shopee-submission/` dir, and the `prisma/` dir. Before deleting, port `src/components/layout/sidebar.tsx` off `next-auth` (`signOut`, `useSession`) to the Supabase signout already at `src/app/auth/signout` — or remove `sidebar.tsx` if `NavBar` has superseded it (the active `(authed)/layout.tsx` renders `NavBar`, not `sidebar`).
- **D-10:** Remove now-orphaned dependencies from `package.json`: `next-auth`, `@prisma/client`, `@prisma/adapter-libsql`, `prisma`, `@libsql/client`, `bcryptjs`. **This is dependency *removal* (cleanup), not addition** — it respects the "no new top-level deps without approval" constraint, but the planner should list each removed dep and confirm no non-legacy importer remains (current grep shows only `sidebar.tsx` for next-auth; everything else is under `_legacy/`).
- **D-11:** Also strip the Shopee/integration DB surface that is now dead: migration `0010_integration_tokens.sql` table and any `integrations` API are out of scope. Prefer a new forward migration that drops the integration-token table rather than editing past migrations (keep migration history append-only).

### Production Login Hardening (FND-03)
- **D-12:** Ensure `/login` cannot 500. Verify the Supabase server/client init (`src/lib/supabase/server.ts`, `client.ts`) fails gracefully (clear error / redirect) when env vars are missing, and confirm required Supabase env vars are set on Vercel. This is the project's #1 timeline risk (Vercel env on Mon 23 Jun) — treat as a release-gating check, not optional.

### Claude's Discretion
- Exact shape of the `requireRole()` helper (return type, redirect vs 403) and the Admin settings UI layout are left to the planner/executor, following existing shadcn/server-action patterns.
- Whether to collapse the role remap into the same migration as the `ACCOUNTS` add, or split — planner's call.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked product brief
- `REQUIREMENTS-draft.md` — the locked brief (roles table, PO workflow, constraints, out-of-scope list). Authoritative source for the four-role model and removal scope.
- `.planning/REQUIREMENTS.md` §Foundation, §Auth & Roles — FND-01..03, AUTH-01..03 (this phase's requirements).
- `.planning/PROJECT.md` §Constraints, §Out of Scope — tech-stack lock (no new deps), four-role lock.

### Existing auth & role surface (read before changing)
- `supabase/migrations/0001_initial_schema.sql` §lines 21–32 (`user_role` enum), §90–139 (`profiles` table, `handle_new_user` trigger, `current_user_role`/`has_role`/`is_super_admin` helpers).
- `src/lib/supabase/server.ts` — `getCurrentUser()` and server client init.
- `src/lib/supabase/client.ts`, `src/lib/supabase/proxy.ts` — client init.
- `src/app/(authed)/layout.tsx` — current auth redirect + `ROLE_LABELS`.
- `src/types/index.ts` — stale app-layer role enum to correct.
- `src/lib/constants.ts` — role constants.

### Out-of-scope code to remove
- `src/_legacy/` (entire tree), `src/app/api/shopee/`, `src/app/(authed)/projection/`, `shopee-submission/`, `prisma/`.
- `supabase/migrations/0010_integration_tokens.sql` — Shopee integration token table (drop via new forward migration).
- `src/components/layout/sidebar.tsx` — still imports `next-auth`; port or delete before dep removal.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `getCurrentUser()` (`src/lib/supabase/server.ts`): the single source of the current user+role — base for the new `requireRole()` helper.
- `(authed)/layout.tsx`: already enforces auth redirect to `/login`; reuse as the auth gate, add role gating below it.
- Postgres `has_role(VARIADIC user_role[])` / `current_user_role()`: reusable for RLS policies.
- `src/app/auth/signout`: existing Supabase signout route to replace `next-auth` signOut in `sidebar.tsx`.

### Established Patterns
- Server Components + server actions read role inline via arrays like `["SUPER_ADMIN","SCM","ADMIN"]` (in `settings/`, `stock/`, `purchase-orders/`). These are the exact call sites to refactor onto `requireRole()` and to purge dead roles from.
- Migrations are append-only, numbered `NNNN_name.sql` under `supabase/migrations/`. Add forward migrations; don't edit history.
- `profiles.role` is auto-populated on signup by the `handle_new_user` trigger from `raw_user_meta_data->>'role'`.

### Integration Points
- Role enum is referenced by FKs/columns across the schema (`profiles`, PO tables) — enum changes are additive only.
- Admin user-management server action needs the Supabase **service-role** key (server env only).
- Removing `next-auth`/`prisma`/`libsql`/`bcryptjs` deps requires `sidebar.tsx` to be ported/removed first or the build breaks.
</code_context>

<specifics>
## Specific Ideas

- The four roles and their responsibilities are fixed by the brief's Roles table: SCM (KPI owner, stock upload, PO drafts, invoice/BL/K1 uploads, payment-slip downloads), ACCOUNTS (signed PO PDF + po_number + targeted ETA), FINANCE (record payments, see balances), ADMIN (everything + user/role management).
- ACCOUNTS is the genuinely new role; it is the actor for PO stage 2 (PO_APPROVED) in Phase 4 — getting it into the enum now unblocks that phase.
</specifics>

<deferred>
## Deferred Ideas

- Remapping the `po_status` enum to the brief's lifecycle (DRAFT → PO_APPROVED → INVOICE_RECEIVED → SHIPPED → RECEIVED) — **Phase 4 (PO Workflow & Finance)**.
- Email/SMS/WhatsApp invite delivery for Admin user management — out of scope (in-app/Supabase email invite only); see v2 NTF-02.
- None of the discussion expanded scope beyond Phase 1's foundation/roles boundary.
</deferred>

---

*Phase: 1-Foundation & Roles*
*Context gathered: 2026-06-22*
