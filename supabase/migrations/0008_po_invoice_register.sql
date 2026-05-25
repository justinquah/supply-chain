-- ============================================================
-- Migration 0008 — PO & Invoice register fields + Finance write access
-- ============================================================

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS invoice_number TEXT,
  ADD COLUMN IF NOT EXISTS invoice_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS invoice_currency currency_code,
  ADD COLUMN IF NOT EXISTS product_group TEXT;   -- product range this PO covers

-- Allow FINANCE to manage POs + documents (they compile invoices too)
DROP POLICY IF EXISTS po_write ON purchase_orders;
CREATE POLICY po_write ON purchase_orders FOR ALL TO authenticated
  USING (
    has_role('SUPER_ADMIN','SCM','ADMIN','LOGISTICS','FINANCE')
    OR (current_user_role() = 'SUPPLIER' AND supplier_id = auth.uid())
  )
  WITH CHECK (
    has_role('SUPER_ADMIN','SCM','ADMIN','LOGISTICS','FINANCE')
    OR (current_user_role() = 'SUPPLIER' AND supplier_id = auth.uid())
  );

DROP POLICY IF EXISTS pod_write ON po_documents;
CREATE POLICY pod_write ON po_documents FOR ALL TO authenticated
  USING (
    has_role('SUPER_ADMIN','SCM','ADMIN','LOGISTICS','FINANCE')
    OR (current_user_role() = 'SUPPLIER'
        AND EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = po_documents.po_id AND po.supplier_id = auth.uid()))
  )
  WITH CHECK (
    has_role('SUPER_ADMIN','SCM','ADMIN','LOGISTICS','FINANCE')
    OR (current_user_role() = 'SUPPLIER'
        AND EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = po_documents.po_id AND po.supplier_id = auth.uid()))
  );
