-- ============================================================
-- Migration 0048 — "to discontinue" flag + remark on products
-- ============================================================
-- Lets the SCM mark a low-stock product as being phased out, so the Insights
-- "Issue new PO" list stops treating it as an open reorder action. This is NOT
-- is_active = false: the product keeps selling down its remaining stock and stays
-- on the dashboard / sales trend until it is actually deactivated.
-- Writes are covered by the existing products_write policy (ADMIN / SCM).
-- ============================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS discontinue_planned   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS discontinue_note      TEXT,
  ADD COLUMN IF NOT EXISTS discontinue_marked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS discontinue_marked_by UUID REFERENCES profiles(id);
