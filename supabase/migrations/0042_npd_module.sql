-- ============================================================
-- Migration 0042 — NPD (New Product Development) module (2026-07-27)
-- ============================================================
-- Replaces the flat product_development_items (empty, never used) with a
-- proper NPD structure:
--   npd_projects    one new-product project: category + target launch date
--   npd_variations  MULTIPLE variations per project, each with its own
--                   commercial details filled in later (USP, key benefit,
--                   RP/RSP price, pack size)
--   npd_checklist   the fixed launch checklist per project:
--                   Formulation → Design → DVS permit → Place PO → Arrival
--                   → Online product info → Offline catalog update
-- The /development tab renders these as a checklist + launch calendar.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.npd_projects (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name               TEXT NOT NULL,
  category_id        UUID REFERENCES public.product_categories(id),
  target_launch_date DATE,                      -- drives the launch calendar
  status             TEXT NOT NULL DEFAULT 'ACTIVE'
                     CHECK (status IN ('ACTIVE','LAUNCHED','ON_HOLD','CANCELLED')),
  notes              TEXT,
  created_by         UUID REFERENCES public.profiles(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.npd_variations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID NOT NULL REFERENCES public.npd_projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,                    -- e.g. "Salmon", "Lavender 5L"
  usp         TEXT,                             -- unique selling point
  key_benefit TEXT,
  rp_price    NUMERIC,                          -- RP (reseller/retail price)
  rsp_price   NUMERIC,                          -- RSP (recommended selling price)
  pack_size   TEXT,                             -- e.g. "70g × 6", "5L"
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_npd_variations_project ON public.npd_variations (project_id);

-- One row per (project, stage); the 7 stages are seeded app-side on project create.
CREATE TABLE IF NOT EXISTS public.npd_checklist (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID NOT NULL REFERENCES public.npd_projects(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL CHECK (stage IN (
                'FORMULATION','DESIGN','DVS_PERMIT','PLACE_PO',
                'ARRIVAL','ONLINE_INFO','OFFLINE_CATALOG')),
  done        BOOLEAN NOT NULL DEFAULT false,
  done_at     TIMESTAMPTZ,
  target_date DATE,                             -- e.g. estimated arrival for ARRIVAL
  notes       TEXT,
  UNIQUE (project_id, stage)
);

-- RLS — NPD is SCM/ADMIN territory (same as the existing Development tab).
ALTER TABLE public.npd_projects   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.npd_variations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.npd_checklist  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS npd_proj_rw ON public.npd_projects;
CREATE POLICY npd_proj_rw ON public.npd_projects FOR ALL TO authenticated
  USING (has_role('SCM','ADMIN')) WITH CHECK (has_role('SCM','ADMIN'));
DROP POLICY IF EXISTS npd_var_rw ON public.npd_variations;
CREATE POLICY npd_var_rw ON public.npd_variations FOR ALL TO authenticated
  USING (has_role('SCM','ADMIN')) WITH CHECK (has_role('SCM','ADMIN'));
DROP POLICY IF EXISTS npd_chk_rw ON public.npd_checklist;
CREATE POLICY npd_chk_rw ON public.npd_checklist FOR ALL TO authenticated
  USING (has_role('SCM','ADMIN')) WITH CHECK (has_role('SCM','ADMIN'));

-- The old flat table was empty and only the rewritten /development pages read it.
DROP TABLE IF EXISTS public.product_development_items;
