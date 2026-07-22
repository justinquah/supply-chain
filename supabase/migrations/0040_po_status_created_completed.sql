-- ============================================================
-- Migration 0040 — Final PO status chain (2026-07-22)
-- ============================================================
-- The chain is now:
--   DRAFT     SCM proposes the order
--   CREATED   Finance/Admin creates the PO in the system + uploads the PO PDF
--   SENT      SCM sent it to the supplier (email function or manual update)
--   SHIPPED   BL uploaded — goods on the water
--   COMPLETED goods inbounded to our system (warehouse receive)
--
-- PO_APPROVED / INVOICE_RECEIVED / RECEIVED become legacy labels; any stray
-- rows are remapped below (all three are 0 rows at migration time).
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run in the same transaction that uses
-- the new label — the two ALTERs are executed separately from the UPDATEs.
-- ============================================================
ALTER TYPE public.po_status ADD VALUE IF NOT EXISTS 'CREATED' AFTER 'DRAFT';
ALTER TYPE public.po_status ADD VALUE IF NOT EXISTS 'COMPLETED' AFTER 'RECEIVED';

-- (run after the enum labels are committed)
--   UPDATE public.purchase_orders SET status='CREATED'   WHERE status='PO_APPROVED';
--   UPDATE public.purchase_orders SET status='SENT'      WHERE status='INVOICE_RECEIVED';
--   UPDATE public.purchase_orders SET status='COMPLETED' WHERE status='RECEIVED';
