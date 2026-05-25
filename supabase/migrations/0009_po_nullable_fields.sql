-- ============================================================
-- Migration 0009 — relax purchase_orders NOT NULLs for the document register
-- (a PO/invoice record may be logged before supplier/source are formalised)
-- ============================================================
ALTER TABLE purchase_orders ALTER COLUMN supplier_id DROP NOT NULL;
ALTER TABLE purchase_orders ALTER COLUMN proposal_source DROP NOT NULL;
