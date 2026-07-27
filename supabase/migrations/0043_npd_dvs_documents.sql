-- ============================================================
-- Migration 0043 — NPD DVS dossier documents (2026-07-27)
-- ============================================================
-- The DVS permit application needs a document dossier per NPD project:
--   CFS_COO          Certificate of Free Sale OR Certificate of Origin
--   DIELINE          Packaging dieline
--   MOCKUP           Packaging mock-up
--   INGREDIENT_LIST  Ingredient list
--   COA              Certificate of Analysis
--   SPIE_LETTER      SPIE letter — required only for NON-fish-ingredient pet
--                    food, hence the per-project applicability flag below.
-- Files live in the existing private `permit-docs` bucket under
-- npd/{project_id}/{doc_type}/... — storage policies already allow
-- authenticated writes there. Multiple files per type are allowed (e.g. two
-- mock-ups); "complete" means at least one file per applicable type.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.npd_documents (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID NOT NULL REFERENCES public.npd_projects(id) ON DELETE CASCADE,
  doc_type    TEXT NOT NULL CHECK (doc_type IN (
                'CFS_COO','DIELINE','MOCKUP','INGREDIENT_LIST','COA','SPIE_LETTER')),
  file_path   TEXT NOT NULL,          -- '<bucket>/<path>' like po_documents
  file_name   TEXT,
  uploaded_by UUID REFERENCES public.profiles(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes       TEXT
);
CREATE INDEX IF NOT EXISTS idx_npd_documents_project ON public.npd_documents (project_id);

-- SPIE letter applies only to non-fish-ingredient products.
ALTER TABLE public.npd_projects
  ADD COLUMN IF NOT EXISTS spie_applicable BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.npd_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS npd_doc_rw ON public.npd_documents;
CREATE POLICY npd_doc_rw ON public.npd_documents FOR ALL TO authenticated
  USING (has_role('SCM','ADMIN')) WITH CHECK (has_role('SCM','ADMIN'));
