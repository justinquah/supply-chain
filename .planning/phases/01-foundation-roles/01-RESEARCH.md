# Phase 01: Foundation & Roles - Research

**Researched:** 2026-06-22
**Domain:** PostgreSQL enum migration, Supabase Auth Admin API, Next.js server-action role gating, dependency removal
**Confidence:** MEDIUM (codebase facts are HIGH — directly read; Postgres/Supabase API patterns are MEDIUM from official docs; env-var specifics are LOW)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Final role set is exactly four: `SCM`, `ACCOUNTS`, `FINANCE`, `ADMIN`. `ACCOUNTS` does not yet exist and MUST be added to the `user_role` enum.
- **D-02:** Migration strategy — **add** `ACCOUNTS` to the enum and treat only the four as valid at the application layer. Do not attempt to physically DROP enum values. Remap existing rows: `SUPER_ADMIN → ADMIN`; `GENERAL/LOGISTICS/WAREHOUSE/SUPPLIER → ADMIN` (or flag for manual reassignment).
- **D-03:** Change the `profiles.role` default away from `'GENERAL'` — new users get an explicit role at invite time. The `handle_new_user` trigger reads role from `raw_user_meta_data`; keep that path, drop the `GENERAL` fallback.
- **D-04:** Fix the stale app-layer enum in `src/types/index.ts` (currently `["ADMIN","FINANCE","SUPPLIER","LOGISTICS"]`) to the four canonical roles.
- **D-05:** Auth mechanism is Supabase Auth (already in place). No new auth system. `next-auth` is to be removed.
- **D-06:** Centralize role gating. Replace scattered inline arrays with a single server-side `requireRole(...roles)` helper built on `getCurrentUser()`.
- **D-07:** Keep the existing Postgres helpers (`current_user_role()`, `has_role()`) for RLS/defense-in-depth. Drop/replace `is_super_admin()` usage (SUPER_ADMIN folds into ADMIN).
- **D-08:** Provide an in-app Admin screen under `src/app/(authed)/settings` to invite users and assign/change their role in `profiles`. Use Supabase Admin API via service-role server action (server-only).
- **D-09:** Delete outright: `src/_legacy/`, `src/app/api/shopee/`, `src/app/(authed)/projection/`, `shopee-submission/`, `prisma/`. Port `src/components/layout/sidebar.tsx` off `next-auth` or delete it (active layout uses `NavBar`, not `sidebar`).
- **D-10:** Remove orphaned deps from `package.json`: `next-auth`, `@prisma/client`, `@prisma/adapter-libsql`, `prisma`, `@libsql/client`, `bcryptjs`. Dependency removal only — no new deps.
- **D-11:** Drop the `integration_tokens` table via a new forward migration (0011). Keep `sync_log` or decide to drop; settle in plan.
- **D-12:** Ensure `/login` cannot 500. Verify Supabase server/client init fails gracefully when env vars are missing. Treat as release-gating.

### Claude's Discretion
- Exact shape of `requireRole()` helper (return type, redirect vs 403) and Admin settings UI layout — follow existing shadcn/server-action patterns.
- Whether to collapse the role remap into the same migration as the `ACCOUNTS` add, or split — planner's call.

### Deferred Ideas (OUT OF SCOPE)
- Remapping `po_status` enum — Phase 4.
- Email/SMS/WhatsApp invite delivery — v2 (NTF-02).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FND-01 | Existing Shopee/marketplace API sync code is removed from the app | D-09/D-10: identified all Shopee touch points; safe removal order documented below |
| FND-02 | Legacy demand-forecasting / container-optimizer / payment-scheduler code is deleted | D-09: `src/_legacy/` contains these; `src/app/(authed)/projection/` is the only live page referencing legacy views |
| FND-03 | Production deploys serve `/login` without a 500 error | D-12: env-var gate and graceful-fail pattern documented; Vercel required vars listed |
| AUTH-01 | A user can sign in and is assigned exactly one of four roles | D-01/D-02/D-03: enum migration + trigger update + handle_new_user pattern researched |
| AUTH-02 | Access to pages and actions is gated by role | D-06: all 5 inline-array call sites enumerated; requireRole() shape designed |
| AUTH-03 | Admin can manage users and assign/change roles | D-08: Admin API pattern researched; inviteUserByEmail + updateUserById + service-role client pattern documented |
</phase_requirements>

---

## Summary

This is a brownfield cleanup + role-model consolidation phase. The app runs on Next.js 16 + Supabase Auth (already working). The work falls into four independent tracks that can be waved in any order but have one hard dependency: **the `next-auth` import in `sidebar.tsx` must be removed before `next-auth` is uninstalled from `package.json`**. Since the active layout uses `NavBar` (not `Sidebar`), the safe path is to delete `sidebar.tsx` entirely before removing the dep.

The Postgres enum migration is the highest-risk item. PostgreSQL cannot DROP enum values, so the only safe path for append-only Supabase migrations is: (1) ADD the new `ACCOUNTS` value with `ALTER TYPE ... ADD VALUE IF NOT EXISTS`, (2) remap existing rows with an `UPDATE profiles SET role = 'ADMIN' WHERE role IN (...)`, and (3) change the column default. All three steps can live in a single migration file as long as `ALTER TYPE ... ADD VALUE` runs **outside** a transaction block — the standard Supabase migration runner executes each statement individually by default.

The `/login` 500 risk is environmental, not code: the `createBrowserClient` and `createServerClient` calls use the `!` non-null assertion on env vars, which throws at runtime if the vars are absent in production. The fix is a defensive guard in `src/lib/supabase/server.ts` and `client.ts` that surfaces a clear error rather than crashing the login route.

**Primary recommendation:** Execute as four waves — (W1) code cleanup + dep removal, (W2) DB migration, (W3) role-gating centralization + type fixes, (W4) Admin user management UI + env hardening.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Role enum migration | Database (Supabase Postgres) | — | Postgres DDL; no app-layer impact until types are updated |
| Role gating enforcement | API / Backend (Server Actions + Server Components) | Database (RLS) | Business logic belongs server-side; RLS is defense-in-depth |
| `requireRole()` helper | API / Backend (src/lib/supabase/server.ts) | — | Server-only, co-located with `getCurrentUser()` |
| Admin user invite/update | API / Backend (server action, service-role key) | — | Admin API requires service role; never client |
| Nav/sidebar update | Frontend (Client Component) | — | NavBar is "use client"; sign-out via `<form action="/auth/signout">` already correct |
| Env-var guard | API / Backend (createClient, createServerClient) | — | Guards fire at request time on the server; login page is a client component that calls browser client |
| Legacy code deletion | — (filesystem) | — | No tier; pure deletion tracked by git |

---

## Standard Stack

No new packages are being added this phase. The relevant existing packages are:

### Core (already installed)
| Library | Version | Purpose | Note |
|---------|---------|---------|------|
| `@supabase/supabase-js` | ^2.105.4 | Supabase client — use `createClient` variant for **admin** operations (service role) | Already a dep |
| `@supabase/ssr` | ^0.10.3 | `createServerClient` / `createBrowserClient` for SSR cookie handling | Already a dep |
| `next` | 16.2.3 | Server Actions, Server Components, App Router | Locked |
| `react` | 19.2.4 | UI | Locked |

### Packages Being Removed
| Package | Why Removed |
|---------|-------------|
| `next-auth` ^4.24.14 | Only importer outside `_legacy` is `sidebar.tsx` which is superseded by `NavBar` |
| `@prisma/client` ^5.22.0 | Only used inside `prisma/` (to be deleted) and `src/_legacy/lib/prisma.ts` |
| `@prisma/adapter-libsql` ^5.22.0 | Prisma adapter, same scope |
| `prisma` ^5.22.0 | Dev dep; no live importers outside `prisma/` |
| `@libsql/client` ^0.17.2 | LibSQL client; no live importers outside `_legacy` |
| `bcryptjs` ^3.0.3 | No live importers outside `_legacy` |

**Removal command (after confirming no surviving importers):**
```bash
npm uninstall next-auth @prisma/client @prisma/adapter-libsql prisma @libsql/client bcryptjs
```

---

## Package Legitimacy Audit

This phase removes packages; it does not add new ones. The two Supabase packages (`@supabase/supabase-js`, `@supabase/ssr`) returned `SUS` from the legitimacy seam due to the `"too-new"` signal — this is a false positive caused by their frequent release cadence (21M and 5M weekly downloads respectively, official Supabase repos on GitHub). Both are pre-existing deps and are not being added in this phase.

| Package | Registry | Weekly DL | Source Repo | Verdict | Disposition |
|---------|----------|-----------|-------------|---------|-------------|
| `@supabase/supabase-js` | npm | 21.6M | github.com/supabase/supabase-js | SUS (false positive — high-DL official package) | Pre-existing dep, approved |
| `@supabase/ssr` | npm | 4.97M | github.com/supabase/ssr | SUS (false positive — same reason) | Pre-existing dep, approved |

**Packages removed due to SLOP verdict:** none
**Packages flagged suspicious:** none (the SUS above are false positives on pre-existing official deps)

---

## Architecture Patterns

### System Architecture Diagram

```
[/login page] ── browser signInWithPassword ──► [Supabase Auth]
                                                       │
                              session cookie ◄─────────┘
                                    │
[Any (authed) route request] ──► [src/proxy.ts → updateSession()]
                                       │
                              valid session? ──NO──► redirect /login
                                       │YES
                                       ▼
                              [src/app/(authed)/layout.tsx]
                                       │
                              getCurrentUser() ──► profiles table ──► role
                                       │
                              redirect /login if null
                                       ▼
                              [Page / Server Component]
                                       │
                              requireRole('SCM','ADMIN') ──NO──► redirect /login (or 403)
                                       │YES
                                       ▼
                              [Server Action] ── service role ──► [Supabase Admin API]
                                                                  auth.admin.inviteUserByEmail
                                                                  auth.admin.updateUserById
```

### Recommended Project Structure for New Files

```
src/
├── lib/
│   └── supabase/
│       ├── server.ts          # ADD: requireRole() helper alongside getCurrentUser()
│       ├── admin.ts           # NEW: createAdminClient() — service role, server-only
│       ├── client.ts          # MODIFY: defensive env-var guard
│       └── proxy.ts           # no change
├── app/
│   └── (authed)/
│       └── settings/
│           ├── page.tsx       # REWRITE: remove Shopee UI; add user-management section
│           ├── actions.ts     # REWRITE: remove syncShopeeStock; add inviteUser, updateRole
│           └── users-table.tsx  # NEW: client component for user list (shadcn Table)
supabase/
└── migrations/
    ├── 0011_role_cleanup.sql  # ADD ACCOUNTS, remap rows, change default
    └── 0012_drop_integration_tokens.sql  # DROP integration_tokens, drop sync_log (if decided)
```

### Pattern 1: requireRole() Server Helper

**What:** A server-only helper that gets the current user, checks their role, and either returns the profile or redirects.

**When to use:** At the top of every Server Component or server action that needs role gating.

```typescript
// src/lib/supabase/server.ts — add alongside getCurrentUser()
import { redirect } from "next/navigation";

export type AppRole = "SCM" | "ACCOUNTS" | "FINANCE" | "ADMIN";

/**
 * Asserts that the current user has one of the allowed roles.
 * In Server Components: calls redirect() (throws internally — Next.js catches it).
 * In Server Actions: returns { ok: false, error: "Unauthorized" } if you prefer
 * not to redirect, OR call redirect() directly — both are valid patterns.
 *
 * The redirect-based pattern is used here to match the existing auth gate
 * in (authed)/layout.tsx.
 */
export async function requireRole(...roles: AppRole[]) {
  const profile = await getCurrentUser();
  if (!profile) redirect("/login");
  if (!(roles as string[]).includes(profile.role)) redirect("/login");
  return profile;
}

// Usage in Server Component:
// const profile = await requireRole("SCM", "ADMIN");

// Usage in Server Action (redirect pattern):
// export async function someAction(formData: FormData) {
//   const profile = await requireRole("ADMIN");
//   // ... rest of action
// }
```

[ASSUMED] — The exact function signature is Claude's discretion per CONTEXT.md, but the redirect pattern matches existing `(authed)/layout.tsx` behaviour. The return type `profile` object is the same shape returned by `getCurrentUser()`.

### Pattern 2: Admin Client (Service Role)

**What:** A `createClient` from `@supabase/supabase-js` (NOT `@supabase/ssr`) initialized with the service-role key. This client bypasses RLS entirely.

**When to use:** Only in `"use server"` server actions for admin operations.

```typescript
// src/lib/supabase/admin.ts — NEW FILE, import only from server actions
import { createClient } from "@supabase/supabase-js";

/**
 * Admin Supabase client — uses service role key, bypasses RLS.
 * NEVER import this in client components or expose SUPABASE_SERVICE_ROLE_KEY
 * via NEXT_PUBLIC_ prefix.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase admin env vars");
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
```

[CITED: supabase.com/docs/guides/troubleshooting - service role pattern] [CITED: github.com/orgs/supabase/discussions/30739]

### Pattern 3: Postgres Enum Migration (Safe, Append-Only)

**What:** Two-migration approach — one to expand the enum and remap data, one to drop the dead DB surface.

**When to use:** Supabase append-only migration history (`supabase/migrations/`).

```sql
-- supabase/migrations/0011_role_cleanup.sql

-- Step 1: Add ACCOUNTS value.
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block; the
-- Supabase migration runner executes each statement individually, which
-- is fine — but DO NOT wrap this in BEGIN/COMMIT.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'ACCOUNTS';

-- Step 2: Remap existing rows from deprecated roles.
-- Run after the ADD VALUE commit (Supabase CLI applies migrations sequentially).
UPDATE public.profiles
  SET role = 'ADMIN'
  WHERE role IN ('SUPER_ADMIN','GENERAL','LOGISTICS','WAREHOUSE','SUPPLIER');

-- Step 3: Remove the GENERAL default from the column.
-- The column default is independently stored; ALTER COLUMN DEFAULT does not
-- need the enum to have fewer members.
ALTER TABLE public.profiles
  ALTER COLUMN role DROP DEFAULT;

-- Step 4: Update the handle_new_user trigger function to remove 'GENERAL' fallback.
-- Replace COALESCE(..., 'GENERAL') with no fallback (trigger will error if role
-- is absent from metadata, which is correct — every invite must supply a role).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    (NEW.raw_user_meta_data->>'role')::user_role
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 5: Update RLS policies that reference dead roles.
-- profiles_select: replace SUPER_ADMIN with ADMIN
DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR has_role('SCM','ADMIN'));

-- profiles_update_self: replace is_super_admin() check
DROP POLICY IF EXISTS profiles_update_self ON profiles;
CREATE POLICY profiles_update_self ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid());

-- profiles_admin_all: replace is_super_admin() with has_role('ADMIN')
DROP POLICY IF EXISTS profiles_admin_all ON profiles;
CREATE POLICY profiles_admin_all ON profiles FOR ALL TO authenticated
  USING (has_role('ADMIN')) WITH CHECK (has_role('ADMIN'));

-- NOTE: is_super_admin() function itself can be left in place (harmless,
-- no rows will ever match 'SUPER_ADMIN') or replaced:
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT has_role('ADMIN');
$$ LANGUAGE SQL STABLE;
```

[CITED: supabase.com/docs/guides/database/postgres/enums] [CITED: github.com/orgs/supabase/discussions/20352]

### Pattern 4: Invite User Server Action

```typescript
// src/app/(authed)/settings/actions.ts
"use server";
import { requireRole } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type AppRole = "SCM" | "ACCOUNTS" | "FINANCE" | "ADMIN";

export async function inviteUser(
  email: string,
  role: AppRole,
  name: string
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("ADMIN");  // throws redirect if not ADMIN

  const adminClient = createAdminClient();
  const { error } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { role, name },  // consumed by handle_new_user trigger
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function updateUserRole(
  userId: string,
  role: AppRole
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("ADMIN");

  // Update profiles table directly (service-role client bypasses RLS)
  const adminClient = createAdminClient();
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
```

[ASSUMED] — The exact interaction between `inviteUserByEmail` `data` field and `handle_new_user` trigger: the trigger reads `raw_user_meta_data->>'role'` which is populated from the `data` option in `inviteUserByEmail`. This is the documented pattern but verify in a test invite before relying on it.

### Anti-Patterns to Avoid

- **Putting `createAdminClient()` in a client component or in a file without `"use server"`:** The `SUPABASE_SERVICE_ROLE_KEY` would be bundled into the client. Always import `admin.ts` only from files marked `"use server"`.
- **Wrapping `ALTER TYPE ... ADD VALUE` in `BEGIN/COMMIT`:** This causes `ERROR: ALTER TYPE ... ADD VALUE cannot run inside a transaction block`. The Supabase migration runner is safe; do not add explicit transaction blocks around this statement.
- **Editing past migration files instead of adding a forward migration:** Breaks CI/CD migration replay. Always add `0011_*.sql`, `0012_*.sql`.
- **Dropping enum values with `ALTER TYPE ... DROP VALUE`:** Not supported in Postgres. The deprecated enum values (`SUPER_ADMIN`, `GENERAL`, etc.) stay in the type definition permanently; only rows and app-layer code need updating.
- **Leaving `next-auth` in `package.json` while `sidebar.tsx` still imports it:** The build will pass (the file is not rendered), but removing the dep without removing the import first causes a build failure.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Session refresh on every request | Custom cookie parsing | `updateSession()` in `src/lib/supabase/proxy.ts` (already exists) | Race conditions, missing cookie flags, CSRF surface |
| Admin user creation | Direct `INSERT INTO auth.users` | `auth.admin.inviteUserByEmail()` via service-role client | Auth schema is internal; direct insert bypasses confirmation, hashing |
| Role validation in SQL | Inline `profile.role = 'SCM' OR profile.role = 'ADMIN'` | `has_role('SCM','ADMIN')` (already exists in DB) | Consistent; type-safe; if enum changes, helper query changes once |
| Password hashing for invite | `bcryptjs` (being removed) | Supabase Auth invite flow handles this | bcryptjs is no longer needed once `_legacy` is gone |

**Key insight:** The session/auth infrastructure already works. This phase is pruning, not building auth from scratch.

---

## Runtime State Inventory

This phase includes a rename/migration component for the `user_role` enum and profile rows.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `public.profiles` table: rows with `role IN ('SUPER_ADMIN','GENERAL','LOGISTICS','WAREHOUSE','SUPPLIER')` — count unknown but expected small (small fixed user set per brief) | `UPDATE profiles SET role = 'ADMIN' WHERE role IN (...)` in migration 0011 |
| Live service config | Supabase Auth project settings: email invite template uses `{{ .ConfirmationURL }}` (standard) — no rename needed | None for this phase |
| OS-registered state | None found — no Task Scheduler, launchd, or pm2 process names referencing the role names | None |
| Secrets/env vars | `SUPABASE_SERVICE_ROLE_KEY` — must be added to Vercel production env (not yet set per D-12 timeline risk). `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` — must be confirmed set on Vercel | Set on Vercel dashboard; verify before deploy |
| Build artifacts | `prisma/dev.db` and `prisma/dev.db-journal` will be deleted with `prisma/`; `node_modules` for removed deps will be cleaned by `npm uninstall` | Delete `prisma/` dir, run `npm uninstall` |

**Nothing found in category:** OS-registered state — verified by directory listing; no systemd/launchd/pm2/scheduler references found.

---

## Common Pitfalls

### Pitfall 1: `ALTER TYPE ADD VALUE` inside a transaction block
**What goes wrong:** Migration fails with `ERROR: ALTER TYPE ... ADD VALUE cannot run inside a transaction block`.
**Why it happens:** The migration file has explicit `BEGIN;`/`COMMIT;` wrapping, or the migration runner wraps everything in a transaction.
**How to avoid:** Do not add `BEGIN`/`COMMIT` around the `ALTER TYPE` statement. Supabase CLI runs each statement individually by default. The `IF NOT EXISTS` modifier also makes it idempotent on re-run.
**Warning signs:** Migration runner returns the error above. Check if the migration file has transaction blocks.

### Pitfall 2: Removing `next-auth` from `package.json` before removing the import from `sidebar.tsx`
**What goes wrong:** `npm build` fails with `Module not found: Can't resolve 'next-auth/react'`.
**Why it happens:** `sidebar.tsx` imports `{ signOut, useSession } from "next-auth/react"` at line 6.
**How to avoid:** Delete `sidebar.tsx` first (it is not rendered — `(authed)/layout.tsx` uses `NavBar`, not `Sidebar`). Then run `npm uninstall next-auth`. Verify with `grep -r "next-auth" src/` returning zero results before the uninstall.
**Warning signs:** Build errors referencing `next-auth/react` after the `npm uninstall`.

### Pitfall 3: `handle_new_user` trigger fails on new invites after removing GENERAL default
**What goes wrong:** A new user is invited without a `role` in metadata, causing `ERROR: invalid input value for enum user_role: NULL` (the COALESCE fallback is removed in migration 0011).
**Why it happens:** After migration 0011 removes `COALESCE(..., 'GENERAL')`, the trigger casts `NULL::user_role` which is invalid.
**How to avoid:** The `inviteUser` server action must always pass `data: { role, name }` with a valid role. Never call `inviteUserByEmail` without the role in `data`. The Admin UI form should enforce role selection before submission.
**Warning signs:** New user creation fails silently or triggers show DB errors in Supabase logs.

### Pitfall 4: RLS policies referencing `is_super_admin()` still gating after role remap
**What goes wrong:** Admin users (now role=ADMIN) cannot manage data because policies call `is_super_admin()` which checks for `SUPER_ADMIN` (no longer exists in any row).
**Why it happens:** Migration 0011 remaps rows but does not update the `is_super_admin()` function body, so the function still returns `FALSE` for all users.
**How to avoid:** Migration 0011 must replace `is_super_admin()` body to delegate to `has_role('ADMIN')`. Affected policies: `profiles_admin_all`, `storage_delete`, `notif_read`, `notif_update`, `audit_read`. See full policy list in the blast-radius section below.
**Warning signs:** Admin user cannot list all profiles, or storage delete fails.

### Pitfall 5: `purchase-orders/page.tsx` queries `profiles` filtered by `role = 'SUPPLIER'`
**What goes wrong:** `supabase.from("profiles").select(...).eq("role", "SUPPLIER")` returns 0 rows after all SUPPLIER rows are remapped to ADMIN, breaking the supplier dropdown in the PO form.
**Why it happens:** The query hardcodes `SUPPLIER` role to find supplier profiles. After migration, no such rows exist.
**How to avoid:** The supplier-selection model needs to change in Phase 4. For Phase 1, either (a) keep a small set of test-supplier profiles (don't remap them to ADMIN yet — but this conflicts with D-02), or (b) remove the SUPPLIER filter and select suppliers by a different signal (e.g., company_name is not null). This is a planning decision — document explicitly in PLAN.md. The brief says suppliers are off-app, so the supplier FK may need to become a simple text field.
**Warning signs:** The PO form's supplier dropdown is empty after migration.

### Pitfall 6: Env vars missing in Vercel production cause login 500
**What goes wrong:** `/login` page crashes with an unhandled error because `createBrowserClient` at `src/lib/supabase/client.ts` is called with `undefined` for URL/key (the `!` assertion silently trusts them but Supabase throws internally).
**Why it happens:** The env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) are not set in the Vercel production environment.
**How to avoid:** Add defensive guards in `createClient()` (client.ts) and `createClient()` (server.ts) that check for the vars before calling the Supabase factory. Also add a Vercel deploy check: Vercel dashboard → Settings → Environment Variables. The D-12 milestone says this must be done by Mon 23 Jun.
**Warning signs:** A 500 error on `/login` in production; Vercel function logs showing `supabaseUrl is required` or similar.

---

## Code Examples

### Verified patterns from existing codebase

#### getCurrentUser() (existing — base for requireRole)
```typescript
// src/lib/supabase/server.ts — lines 33-47 (read directly from codebase)
export async function getCurrentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, name, role, company_name, is_active")
    .eq("id", user.id)
    .single();
  return profile;
}
```
[VERIFIED: read directly from src/lib/supabase/server.ts]

#### Existing auth/signout route (target for sidebar.tsx migration)
```typescript
// src/app/auth/signout/route.ts — POST handler, redirects to /login with 303
export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
```
[VERIFIED: read directly from src/app/auth/signout/route.ts]

#### NavBar already uses form-based signout (no next-auth dependency)
```tsx
// src/components/nav-bar.tsx — lines 79-84
<form action="/auth/signout" method="post">
  <button type="submit" ...>Sign out</button>
</form>
```
[VERIFIED: read directly from src/components/nav-bar.tsx]

#### Defensive env-var guard pattern for client.ts
```typescript
// src/lib/supabase/client.ts — MODIFIED version
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }
  return createBrowserClient(url, key);
}
```
[ASSUMED] — The guard pattern; the error message text is discretionary.

---

## Blast Radius: Full `user_role` Reference Map

Every place in the codebase that references the `user_role` enum or specific role values (read directly from source):

### Database layer (migration 0011 must address each)
| Object | Location | Current Dead Roles Referenced | Action |
|--------|----------|-------------------------------|--------|
| `user_role` enum definition | `0001_initial_schema.sql` line 22 | SUPER_ADMIN, GENERAL, LOGISTICS, WAREHOUSE, SUPPLIER | ADD ACCOUNTS; others stay in enum (cannot drop) |
| `profiles.role` column default | `0001_initial_schema.sql` line 95 | `DEFAULT 'GENERAL'` | DROP DEFAULT |
| `handle_new_user()` trigger | `0001_initial_schema.sql` line 115 | `COALESCE(..., 'GENERAL')` | Replace with direct cast (no GENERAL fallback) |
| `is_super_admin()` function | `0001_initial_schema.sql` line 137 | `SUPER_ADMIN` | Replace body with `has_role('ADMIN')` |
| `profiles_select` policy | `0001_initial_schema.sql` line 427 | `has_role('SUPER_ADMIN','SCM','ADMIN')` | Replace with `has_role('SCM','ADMIN')` |
| `profiles_update_self` policy | `0001_initial_schema.sql` line 430 | `is_super_admin()` | Remove the `OR is_super_admin()` clause |
| `profiles_admin_all` policy | `0001_initial_schema.sql` line 433 | `is_super_admin()` | Replace with `has_role('ADMIN')` |
| `products_read` policy | `0001_initial_schema.sql` line 447 | `GENERAL, LOGISTICS, WAREHOUSE` | Remove dead roles; add `ACCOUNTS` |
| `po_read` policy | `0001_initial_schema.sql` line 484 | `LOGISTICS, WAREHOUSE, SUPPLIER, GENERAL` | Replace with `has_role('SCM','ACCOUNTS','FINANCE','ADMIN')` |
| `po_write` policy | `0001_initial_schema.sql` line 492 | `LOGISTICS, SUPPLIER` | Replace with `has_role('SCM','ACCOUNTS','ADMIN')` |
| `poli_read` policy | `0001_initial_schema.sql` line 506 | `LOGISTICS, WAREHOUSE, GENERAL, SUPPLIER` | Simplify |
| `ship_read` / `ship_write` | `0001_initial_schema.sql` lines 516-525 | `LOGISTICS` | Remove |
| `pod_read` / `pod_write` | `0001_initial_schema.sql` lines 529-546 | `LOGISTICS, SUPPLIER` | Simplify |
| `sr_read` / `sr_write` | `0001_initial_schema.sql` lines 564-577 | `WAREHOUSE, GENERAL, LOGISTICS` | Simplify |
| `rp_read` / `rp_write` | `0001_initial_schema.sql` lines 580-594 | `WAREHOUSE, LOGISTICS, GENERAL` | Simplify |
| `audit_read` | `0001_initial_schema.sql` line 599 | `SUPER_ADMIN` | Replace with `has_role('ADMIN')` |
| `notif_read` / `notif_update` | `0001_initial_schema.sql` lines 603-607 | `is_super_admin()` | Replace with `has_role('ADMIN')` |
| `storage_delete` policy | `0001_initial_schema.sql` line 637 | `is_super_admin()` | Replace with `has_role('ADMIN')` |
| `integration_tokens` table | `0010_integration_tokens.sql` | SUPER_ADMIN refs in policy | Drop table entirely (migration 0012) |

### Application layer (code edits, not SQL)
| File | Line(s) | Dead Role References | Action |
|------|---------|---------------------|--------|
| `src/types/index.ts` | 7, 14 | `SUPPLIER, LOGISTICS` | Replace enum with `SCM, ACCOUNTS, FINANCE, ADMIN` |
| `src/lib/constants.ts` | 1-13 | `SUPPLIER, LOGISTICS` | Replace ROLES and ROLE_LABELS with four canonical roles |
| `src/app/(authed)/layout.tsx` | 5-14 | `SUPER_ADMIN, GENERAL, LOGISTICS, WAREHOUSE, SUPPLIER` | Replace ROLE_LABELS with four canonical entries |
| `src/app/(authed)/settings/page.tsx` | 13 | `SUPER_ADMIN` | Replace `["SUPER_ADMIN","SCM","ADMIN"]` with `requireRole("SCM","ADMIN")` |
| `src/app/(authed)/settings/actions.ts` | 7 | `SUPER_ADMIN` | Replace `CAN_SYNC` with `requireRole` pattern; entire Shopee action is deleted |
| `src/app/(authed)/purchase-orders/page.tsx` | 6, 31 | `SUPER_ADMIN, FINANCE, LOGISTICS`; `.eq("role","SUPPLIER")` | Replace `CAN_WRITE` with `requireRole`; fix supplier query (see Pitfall 5) |
| `src/app/(authed)/purchase-orders/actions.ts` | 6 | `SUPER_ADMIN, FINANCE, LOGISTICS` | Replace `CAN_WRITE` with `requireRole` |
| `src/app/(authed)/stock/page.tsx` | 7 | `SUPER_ADMIN` | Replace with `requireRole("SCM","ADMIN")` |
| `src/app/(authed)/stock/actions.ts` | 11 | `SUPER_ADMIN` | Replace with `requireRole("SCM","ADMIN")` |
| `src/components/layout/sidebar.tsx` | 6 | `next-auth` import | **Delete entire file** (superseded by NavBar) |
| `src/components/nav-bar.tsx` | 8 | `/projection` nav item | Remove `/projection` from NAV array |

### Files to Delete Entirely (no code edits needed)
| Path | Why |
|------|-----|
| `src/_legacy/` (93 files) | Legacy code (D-09) |
| `src/app/api/shopee/auth/route.ts` | Shopee API route (D-09) |
| `src/app/api/shopee/callback/route.ts` | Shopee OAuth callback (D-09) |
| `src/app/(authed)/projection/page.tsx` | Demand projection page (D-09/FND-02) |
| `src/app/(authed)/settings/sync-button.tsx` | Shopee sync UI (D-09) |
| `src/lib/shopee.ts` | Shopee API client (D-09) |
| `src/components/layout/sidebar.tsx` | Superseded by NavBar; sole non-legacy `next-auth` importer |
| `shopee-submission/` (top-level) | Shopee submission tooling (D-09) |
| `prisma/` (all files) | Prisma schema/migrations/seed (D-09) |

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `next-auth` session + `useSession()` | Supabase Auth cookies + `getCurrentUser()` | Already migrated in the codebase; `sidebar.tsx` is the only holdout |
| `middleware.ts` for session refresh | `src/proxy.ts` (Next 16 naming) calling `updateSession()` | Already in place; no middleware.ts needed |
| Inline role arrays `["SUPER_ADMIN","SCM"]` | `requireRole("SCM","ADMIN")` helper | Migration task for this phase |
| `is_super_admin()` DB function checking SUPER_ADMIN | `has_role('ADMIN')` | Replace function body; don't drop it (policies reference it) |

**Deprecated/outdated in this codebase:**
- `sidebar.tsx`: superseded by `nav-bar.tsx` — the layout renders `NavBar`, not `Sidebar`. Delete.
- `src/lib/shopee.ts`: 232-line Shopee API client — delete with everything else Shopee.
- `prisma/` directory: prisma schema and SQLite dev database — no live imports outside `_legacy`.
- `0010_integration_tokens.sql` table: `integration_tokens` — drop via migration 0012. `sync_log` table was used by settings/actions.ts which is being rewritten; planner to decide whether to keep `sync_log` for future use or drop it in 0012 as well.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `inviteUserByEmail` `data` option populates `raw_user_meta_data` which is read by `handle_new_user` trigger | Pattern 4 (Invite User) | New users invited through the Admin UI would get no role set, trigger would throw |
| A2 | `handle_new_user` trigger with a direct cast (no COALESCE) will throw a DB error if role is missing, blocking invite | Pattern 3 (enum migration) | Could silently insert NULL or default — depends on Postgres NOT NULL constraint on `profiles.role` |
| A3 | Removing SUPPLIER-role rows means the PO page supplier dropdown breaks immediately | Blast Radius / Pitfall 5 | If no real SUPPLIER-role data exists, no breakage — but planner should confirm |
| A4 | `shopee-submission/` top-level directory contains no code imported by any live `src/` route | Files to Delete | If there are imports, deleting the directory will break the build |
| A5 | `sync_log` table has no live imports after settings/actions.ts is rewritten | State of Art | If other routes reference sync_log, dropping it in migration 0012 breaks them |
| A6 | The service-role key env var name convention used is `SUPABASE_SERVICE_ROLE_KEY` (no NEXT_PUBLIC_ prefix) | Pattern 2 (Admin Client) | Wrong name means admin client initialization fails silently |

---

## Open Questions

1. **SUPPLIER-role profiles handling (Pitfall 5)**
   - What we know: `purchase-orders/page.tsx` queries `.eq("role","SUPPLIER")` to build the supplier dropdown.
   - What's unclear: Whether any real SUPPLIER-role profiles exist in production that are actually used for PO supplier selection, vs. the brief saying suppliers are off-app.
   - Recommendation: Planner must decide — either (a) migrate SUPPLIER rows to ADMIN like the rest (breaking the PO form's supplier lookup, which is Phase 4 work to fix properly), or (b) create a `company_name IS NOT NULL` filter as a temporary substitute. Phase 4 redesigns the PO flow anyway.

2. **`sync_log` table**
   - What we know: Created in migration 0010 alongside `integration_tokens`; referenced only by the Shopee settings action (being deleted).
   - What's unclear: Whether keeping `sync_log` for future non-Shopee audit logging is worthwhile.
   - Recommendation: Drop it in migration 0012 (it's Shopee-specific). If a general audit log is needed later, add a new migration.

3. **RLS policy scope for ACCOUNTS role**
   - What we know: ACCOUNTS will be added to the enum. The existing RLS policies don't mention ACCOUNTS.
   - What's unclear: Which tables ACCOUNTS users need to read/write.
   - Recommendation: Minimum viable access for Phase 1 — ACCOUNTS needs to read `purchase_orders` and write `po_documents` (PO_PDF bucket). This is Phase 4 work for the full workflow but the RLS migration in 0011 should add ACCOUNTS where appropriate. Planner should include ACCOUNTS in `po_read` and `pod_write` policies.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | All Supabase clients | Unknown (Vercel not confirmed) | — | None — blocking |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All Supabase clients | Unknown (Vercel not confirmed) | — | None — blocking |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin user management | Not yet set | — | None — blocking for AUTH-03 |
| Node.js / npm | Dependency removal | Available (dev machine) | — | — |
| Supabase CLI | Running migrations | [ASSUMED: available] | — | Run SQL directly via Supabase dashboard |

**Missing dependencies with no fallback:**
- Vercel env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) — must be set before or on Mon 23 Jun (D-12 milestone). Every phase depends on this.

**Missing dependencies with fallback:**
- Supabase CLI: if unavailable locally, migrations can be pasted into the Supabase SQL Editor directly.

---

## Validation Architecture

> `workflow.nyquist_validation` is `false` in `.planning/config.json`. This section is SKIPPED per config.

---

## Security Domain

`security_enforcement: true` in `.planning/config.json`.

### Applicable ASVS Categories (ASVS Level 1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes — sign-in, invite flow | Supabase Auth (already in place); `inviteUserByEmail` sends magic-link |
| V3 Session Management | Yes — session refresh on every request | `updateSession()` in proxy.ts (already in place) |
| V4 Access Control | Yes — role gating is the main deliverable | `requireRole()` server helper + RLS policies (defense-in-depth) |
| V5 Input Validation | Yes — invite form (email, role) | `zod` schema in `src/types/index.ts` (update role enum); role value validated server-side before DB write |
| V6 Cryptography | No | Supabase handles password hashing; `bcryptjs` is being removed |

### Known Threat Patterns for this Phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Service role key exposure in client bundle | Information Disclosure | Never use `NEXT_PUBLIC_` prefix for `SUPABASE_SERVICE_ROLE_KEY`; only import `admin.ts` from `"use server"` files |
| Role escalation via invite metadata | Elevation of Privilege | `requireRole("ADMIN")` guard at the top of `inviteUser` server action; validate role value against the AppRole type |
| Stale role in JWT/session vs profiles table | Spoofing | `getCurrentUser()` always fetches from `profiles` table, not from JWT claims — this is correct and already in place |
| Dead enum values in RLS policies letting deprecated-role users through | Elevation of Privilege | After row remap to ADMIN, no rows will have SUPER_ADMIN/GENERAL/etc. — policies referencing those roles are effectively dead-leg guards. Still clean them up for clarity. |
| Missing env var causes server error on /login | Denial of Service | Add defensive guard in `createClient()` (client.ts) before calling Supabase factory |

---

## Sources

### Primary (codebase — HIGH confidence, read directly)
- `supabase/migrations/0001_initial_schema.sql` — complete schema, all enum values, all RLS policies, helper functions
- `supabase/migrations/0010_integration_tokens.sql` — integration_tokens and sync_log tables
- `src/lib/supabase/server.ts` — `createClient()`, `getCurrentUser()`
- `src/lib/supabase/client.ts` — `createBrowserClient()`
- `src/lib/supabase/proxy.ts` — `updateSession()` session refresh logic
- `src/proxy.ts` — Next.js proxy entry point (formerly middleware.ts)
- `src/app/(authed)/layout.tsx` — active auth gate and NavBar rendering
- `src/app/(authed)/settings/page.tsx` + `actions.ts` — Shopee-only settings (full deletion)
- `src/app/(authed)/purchase-orders/page.tsx` + `actions.ts` — role inline arrays + SUPPLIER query
- `src/app/(authed)/stock/page.tsx` + `actions.ts` — role inline arrays
- `src/components/layout/sidebar.tsx` — sole non-legacy `next-auth` importer
- `src/components/nav-bar.tsx` — active nav; already uses `/auth/signout` form POST
- `src/types/index.ts` — stale Zod role enum
- `src/lib/constants.ts` — stale ROLES/ROLE_LABELS constants
- `package.json` — confirmed all 6 orphaned deps present

### Secondary (official docs/discussions — MEDIUM confidence)
- [Managing Enums in Postgres | Supabase Docs](https://supabase.com/docs/guides/database/postgres/enums) — ADD VALUE pattern, removal constraints
- [Supabase Discussion #20352](https://github.com/orgs/supabase/discussions/20352) — ALTER TYPE ADD VALUE preferred over rename/drop pattern
- [Supabase auth.admin.inviteUserByEmail](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail) — function signature and options
- [Supabase Discussion #30739](https://github.com/orgs/supabase/discussions/30739) — service role client pattern for Next.js
- [Vercel + Supabase env var names](https://vercel.com/academy/subscription-store/supabase-project-setup) — SUPABASE_SERVICE_ROLE_KEY naming convention
- [Setting up Server-Side Auth for Next.js | Supabase Docs](https://supabase.com/docs/guides/auth/server-side/nextjs) — required env vars and proxy/middleware pattern

### Tertiary (LOW confidence — web search summaries)
- PostgreSQL docs re: transaction block restriction on ALTER TYPE ADD VALUE

---

## Metadata

**Confidence breakdown:**
- Standard stack (existing deps): HIGH — read directly from package.json and source files
- Codebase blast radius (all call sites): HIGH — grep-verified against every non-legacy .ts/.tsx file
- Postgres enum migration pattern (ADD VALUE + row remap): MEDIUM — confirmed via Supabase docs and community discussion
- Admin API (`inviteUserByEmail` + service-role client): MEDIUM — confirmed via Supabase JS docs; specific `data` field → trigger interaction is ASSUMED (A1)
- Env var naming convention: MEDIUM — confirmed via Vercel/Supabase official integration docs

**Research date:** 2026-06-22
**Valid until:** 2026-07-22 (stable domain; valid for this sprint)
