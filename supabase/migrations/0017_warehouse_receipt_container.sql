-- ============================================================
-- Migration 0017 — Phase 4C: Warehouse goods-receipt + container arrival/unload
-- ============================================================
-- One PO = one container (per the 2026-06-22 decision). WAREHOUSE records the goods receipt
-- against the PO: quantity received + damaged/short as a remark (informational — does NOT change
-- stock figures / KPI snapshots, per WHS-01), optional proof photo (WHS-02, receipt-photos bucket),
-- and the container's arrived-at + unload-completed timestamps (WHS-04) from which unload duration
-- is derived. All nullable / additive.
-- ============================================================

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS container_arrived_at DATE,        -- WHS-04: container arrived at warehouse
  ADD COLUMN IF NOT EXISTS unload_completed_at TIMESTAMPTZ,  -- WHS-04: fully unloaded + updated to system
  ADD COLUMN IF NOT EXISTS received_qty INT,                 -- WHS-01: qty received (remark-only, no stock change)
  ADD COLUMN IF NOT EXISTS damaged_qty INT,                  -- WHS-01: qty damaged/short
  ADD COLUMN IF NOT EXISTS receipt_remark TEXT,              -- WHS-01: free-text remark
  ADD COLUMN IF NOT EXISTS receipt_proof_path TEXT;          -- WHS-02: proof photo path (receipt-photos bucket)
