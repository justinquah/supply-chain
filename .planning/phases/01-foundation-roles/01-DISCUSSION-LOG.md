# Phase 1: Foundation & Roles - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-22
**Phase:** 1-Foundation & Roles
**Mode:** --auto (recommended defaults auto-selected; no interactive prompts)
**Areas discussed:** Role enum migration, Role-gating mechanism, Out-of-scope code removal, Admin user management, Login-500 hardening

---

## Role Enum Migration

| Option | Description | Selected |
|--------|-------------|----------|
| Add ACCOUNTS, deprecate extras at app layer | Additive enum change; remap existing rows; drop GENERAL default | ✓ |
| Rebuild enum type to exactly 4 values | Rename old type, create new, cast columns — cleaner but risky with FK/column deps | |

**Choice:** Add `ACCOUNTS`; enforce the four-role set in the app layer; remap existing rows; drop `'GENERAL'` default.
**Notes:** Postgres can't safely drop enum members referenced by columns/defaults; additive migration is the low-risk path for a 9-day timeline.

---

## Role-Gating Mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Centralize into requireRole() helper | Single server helper over getCurrentUser(); purge dead-role arrays | ✓ |
| Keep scattered inline arrays | Leave per-page `["SUPER_ADMIN","SCM","ADMIN"]` checks as-is | |
| RLS-first | Make Postgres RLS the primary gate | |

**Choice:** Centralize into `requireRole()` + existing layout redirect; keep RLS as defense-in-depth.
**Notes:** Scattered arrays currently reference dead roles (SUPER_ADMIN, LOGISTICS); centralizing removes that drift.

---

## Out-of-Scope Code Removal

| Option | Description | Selected |
|--------|-------------|----------|
| Delete _legacy + shopee + projection outright | Remove dirs + orphaned deps; git history preserves them | ✓ |
| Keep _legacy for reference, exclude from build | Leave tree in place | |

**Choice:** Delete `src/_legacy/`, `src/app/api/shopee/`, `(authed)/projection/`, `shopee-submission/`, `prisma/`; drop legacy-only deps after porting `sidebar.tsx` signout.
**Notes:** `next-auth` still imported by active `sidebar.tsx` — must port/remove before dep removal or the build breaks.

---

## Admin User Management

| Option | Description | Selected |
|--------|-------------|----------|
| In-app admin screen via Supabase Admin API | Invite + role change under (authed)/settings, service-role server action | ✓ |
| Supabase dashboard only (no in-app UI) | Manage users manually outside the app | |

**Choice:** In-app admin screen under `(authed)/settings` using the Supabase Admin API (server-only service role).

---

## Login-500 Hardening (FND-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Treat as release-gating verification | Ensure env-var presence + graceful init failure for `/login` | ✓ |

**Choice:** Verify Supabase client init fails gracefully on missing env and confirm Vercel env vars are set.
**Notes:** This is the project's top timeline risk (Vercel env on Mon 23 Jun).

## Claude's Discretion

- Exact `requireRole()` signature (redirect vs 403) and Admin settings UI layout.
- Whether the ACCOUNTS-add and the role remap share one migration or split.

## Deferred Ideas

- `po_status` enum remap to DRAFT→…→RECEIVED — Phase 4.
- Email/SMS/WhatsApp invite delivery — out of scope (v2 NTF-02).
