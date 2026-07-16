-- ============================================================
-- Migration 0034 — Bank credit limits for BA / Invoice Financing (2026-07-16)
-- ============================================================
-- Each bank grants a facility limit for Banker's Acceptance + Invoice Financing.
-- Outstanding financing (obligations not yet due) consumes the limit; once an
-- obligation's due date is reached it is settled and the limit frees up.
-- Finance needs to see, per bank: limit / outstanding / available headroom.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bank_credit_limits (
  bank         TEXT PRIMARY KEY,              -- must match financing_obligations.bank
  short_name   TEXT,                          -- display label, e.g. "Maybank" / "UOB"
  limit_amount NUMERIC NOT NULL CHECK (limit_amount >= 0),
  currency     currency_code NOT NULL DEFAULT 'MYR',
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bank_credit_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bcl_read ON public.bank_credit_limits;
CREATE POLICY bcl_read ON public.bank_credit_limits FOR SELECT TO authenticated
  USING (has_role('SCM','ADMIN','ACCOUNTS','FINANCE'));
DROP POLICY IF EXISTS bcl_write ON public.bank_credit_limits;
CREATE POLICY bcl_write ON public.bank_credit_limits FOR ALL TO authenticated
  USING (has_role('SCM','ADMIN','ACCOUNTS','FINANCE')) WITH CHECK (has_role('SCM','ADMIN','ACCOUNTS','FINANCE'));

-- Seed the two live facilities (bank strings match existing financing_obligations rows).
INSERT INTO public.bank_credit_limits (bank, short_name, limit_amount, currency)
VALUES
  ('MAYBANK ISLAMIC BERHAD', 'Maybank', 800000, 'MYR'),
  ('UNITED OVERSEAS BANK (MALAYSIA) BHD', 'UOB', 430000, 'MYR')
ON CONFLICT (bank) DO UPDATE
  SET short_name = EXCLUDED.short_name,
      limit_amount = EXCLUDED.limit_amount,
      currency = EXCLUDED.currency,
      updated_at = now();
