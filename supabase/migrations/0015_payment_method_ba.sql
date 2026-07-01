-- ============================================================
-- Migration 0015 — Phase 4B: payment method + Banker's Acceptance terms
-- ============================================================
-- Finance can pay a supplier either from BANK BALANCE (cash out now) or via a
-- BANKER'S ACCEPTANCE (the bank accepts a draft now; cash settles later — BA terms
-- commonly run up to 120 days from the goods' arrival date). Either way the supplier
-- is covered, so the payment counts toward the PO balance (v_po_balance) and the
-- RECEIVED gate; but a BA creates a FUTURE cash obligation that Finance must see coming.
--
-- New columns on payments:
--   payment_method : BANK_BALANCE (default) | BANKERS_ACCEPTANCE
--   ba_term_days   : BA tenor in days (0–120), based on arrival date        (NULL for bank balance)
--   ba_due_date    : when the BA settles (arrival_date + ba_term_days)       (NULL for bank balance)
-- ============================================================

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('BANK_BALANCE', 'BANKERS_ACCEPTANCE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_method payment_method NOT NULL DEFAULT 'BANK_BALANCE',
  ADD COLUMN IF NOT EXISTS ba_term_days INT
    CHECK (ba_term_days IS NULL OR (ba_term_days >= 0 AND ba_term_days <= 120)),
  ADD COLUMN IF NOT EXISTS ba_due_date DATE;
