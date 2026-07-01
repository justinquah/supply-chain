-- ============================================================
-- Migration 0019 — Product vs Supplier configuration split (2026-07-01)
-- ============================================================
-- Decisions:
--  * launch_date on products drives the KPI new-SKU exclusion (>6 months past launch).
--  * payment terms live at the SUPPLIER level (on the supplier profile) — POs inherit, no override.
--  * cost stays per (product, supplier) on product_suppliers; add a cost-change HISTORY so cost
--    trend / improvement can be monitored over time.
-- ============================================================

-- 1. Product launch date (editable; KPI eligibility uses this, falling back to created_at) ------
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS launch_date DATE;

-- 2. Supplier-level payment terms (on the supplier profile record) -------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS supplier_payment_terms TEXT,
  ADD COLUMN IF NOT EXISTS supplier_deposit_percent NUMERIC
    CHECK (supplier_deposit_percent IS NULL OR (supplier_deposit_percent >= 0 AND supplier_deposit_percent <= 100));

-- 3. Cost-change history per (product, supplier) -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_supplier_cost_history (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id     UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  supplier_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  unit_cost      NUMERIC NOT NULL,
  cost_currency  currency_code,
  effective_from DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date),
  note           TEXT,
  recorded_by    UUID REFERENCES public.profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pscost_prod_supp
  ON public.product_supplier_cost_history (product_id, supplier_id, effective_from DESC);

ALTER TABLE public.product_supplier_cost_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS psc_read ON public.product_supplier_cost_history;
CREATE POLICY psc_read ON public.product_supplier_cost_history FOR SELECT TO authenticated
  USING (has_role('SCM','ACCOUNTS','FINANCE','ADMIN'));
DROP POLICY IF EXISTS psc_write ON public.product_supplier_cost_history;
CREATE POLICY psc_write ON public.product_supplier_cost_history FOR ALL TO authenticated
  USING (has_role('SCM','ADMIN')) WITH CHECK (has_role('SCM','ADMIN'));
