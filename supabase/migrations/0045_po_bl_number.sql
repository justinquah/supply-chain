-- ============================================================
-- Migration 0045 — BL number on the PO (2026-07-28)
-- ============================================================
-- Uploading a Bill of Lading must capture the BL number alongside the
-- container number (user rule 2026-07-28). Stored on the PO like
-- container_number; uploadPoDocument enforces presence for BL uploads
-- unless the PO already carries the value.
-- ============================================================
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS bl_number TEXT;

COMMENT ON COLUMN public.purchase_orders.bl_number IS
  'Bill of Lading number, keyed when the BL is uploaded.';
