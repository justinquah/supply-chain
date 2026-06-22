<!-- GSD:project-start source:PROJECT.md -->

## Project

**JJANGX3 Supply Chain**

An internal web app that moves JJANGX3's supply chain off spreadsheets onto one system. It does three things: (1) scores how well stock is managed via Overstock % / OOS % KPIs across month/quarter/FY, (2) tracks every purchase order through its hand-offs (SCM → Accounts → SCM → Finance → Warehouse), and (3) goes live 1 July 2026. Users are five internal roles: SCM, Accounts, Finance, Admin, Warehouse.

**Core Value:** The SCM signs in and sees trustworthy Overstock % and OOS % KPI tiles for the current FY/Quarter/Month, driven by weekly stock uploads — and every PO is traceable end-to-end through its hand-offs. If everything else fails, the KPI dashboard and the PO workflow must work.

### Constraints

- **Tech stack**: Next.js 16 + Turbopack, React 19, Supabase (Postgres + Auth + Storage), shadcn/ui, Tailwind 4 — **no new top-level dependencies without explicit approval**.
- **Roles**: exactly five (SCM, Accounts, Finance, Admin, Warehouse). (WAREHOUSE added 2026-06-22; do NOT reduce back to four.)
- **Currency**: MYR.
- **Timezone**: Asia/Kuala_Lumpur — all Monday/snapshot computation in this TZ.
- **Financial Year**: Oct → Sep (FY25/26 = 1 Oct 2025 – 30 Sep 2026).
- **Timeline**: Go-live 1 Jul 2026; 9-day build window. Every day of Vercel-env delay compresses the rest.

<!-- GSD:project-end -->

<!-- GSD:stack-start source:STACK.md -->

## Technology Stack

Technology stack not yet documented. Will populate after codebase mapping or first phase.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
