-- ============================================================
-- Migration 0031 — Ocean freight cost per PO (2026-07-09)
-- ============================================================
-- Some purchases carry an ocean-freight charge (paid to the forwarder) on top of the
-- product cost. Usually quoted in USD. Add-on cost, editable later by SCM/Finance;
-- combined with the product value (expected_invoice_amount) for a landed total.
-- ============================================================
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS ocean_freight_cost     NUMERIC,
  ADD COLUMN IF NOT EXISTS ocean_freight_currency currency_code;
