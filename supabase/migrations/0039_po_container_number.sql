-- ============================================================
-- Migration 0039 — Container number on the PO (2026-07-22)
-- ============================================================
-- The shipments table has a container_number column but is unused (0 rows) —
-- all real shipment data (ETD/ETA, BL, K1, arrival) lives on purchase_orders.
-- Put the container number there too, editable by SCM/Admin/Logistics.
-- ============================================================
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS container_number TEXT;

COMMENT ON COLUMN public.purchase_orders.container_number IS
  'Shipping container number (e.g. MSKU1234567). Free text — some POs share or split containers.';
