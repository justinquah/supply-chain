-- ============================================================
-- Migration 0014 — Phase 4: PO workflow columns, balance view, role grants
-- ============================================================
-- Runs AFTER 0013 (the 5 new po_status values are committed).
-- Adds the brief PO-01 fields (expected amount, deposit %, payment terms) + the deposit/balance
-- due dates that drive the Finance calendar, a per-PO balance view, and the WAREHOUSE/LOGISTICS
-- RLS grants the workflow needs. Field-level "who can do what at which stage" is enforced in the
-- server actions (app layer); RLS here is the coarse role gate, consistent with the existing app.
-- ============================================================

-- 1. Columns on purchase_orders -------------------------------------------------
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS expected_invoice_amount NUMERIC,                       -- PO-01: SCM's estimate at draft
  ADD COLUMN IF NOT EXISTS deposit_percent NUMERIC
    CHECK (deposit_percent IS NULL OR (deposit_percent >= 0 AND deposit_percent <= 100)),
  ADD COLUMN IF NOT EXISTS payment_terms TEXT,
  ADD COLUMN IF NOT EXISTS deposit_due_date DATE,                                 -- Finance calendar: deposit leg
  ADD COLUMN IF NOT EXISTS balance_due_date DATE,                                 -- Finance calendar: balance leg
  ADD COLUMN IF NOT EXISTS invoice_date DATE,                                     -- supplier invoice date (INVOICE_RECEIVED)
  ADD COLUMN IF NOT EXISTS targeted_eta DATE,                                     -- Accounts sets at PO_APPROVED
  ADD COLUMN IF NOT EXISTS actual_eta DATE;                                       -- Logistics sets at SHIPPED

-- New POs start as DRAFT (the 5 values are now committed from 0013).
ALTER TABLE public.purchase_orders ALTER COLUMN status SET DEFAULT 'DRAFT';

-- 2. Per-PO balance view (drives RECEIVED gate + Finance inbox/calendar) ---------
-- total = actual invoice amount once known, else the PO estimate; paid = sum of PAID payments.
CREATE OR REPLACE VIEW public.v_po_balance AS
SELECT
  po.id AS po_id,
  COALESCE(po.invoice_amount, po.expected_invoice_amount, 0) AS total_amount,
  COALESCE((SELECT SUM(p.amount) FROM public.payments p
            WHERE p.po_id = po.id AND p.status = 'PAID'), 0) AS amount_paid,
  COALESCE(po.invoice_amount, po.expected_invoice_amount, 0)
    - COALESCE((SELECT SUM(p.amount) FROM public.payments p
                WHERE p.po_id = po.id AND p.status = 'PAID'), 0) AS balance_remaining
FROM public.purchase_orders po;

GRANT SELECT ON public.v_po_balance TO authenticated;

-- 3. RLS grants for WAREHOUSE + LOGISTICS ---------------------------------------
-- purchase_orders: all six roles can read; workflow roles can write (server actions gate the stage).
DROP POLICY IF EXISTS po_read ON public.purchase_orders;
CREATE POLICY po_read ON public.purchase_orders FOR SELECT TO authenticated
  USING (has_role('SCM','ACCOUNTS','FINANCE','ADMIN','WAREHOUSE','LOGISTICS'));

DROP POLICY IF EXISTS po_write ON public.purchase_orders;
CREATE POLICY po_write ON public.purchase_orders FOR ALL TO authenticated
  USING (has_role('SCM','ACCOUNTS','FINANCE','ADMIN','LOGISTICS','WAREHOUSE'))
  WITH CHECK (has_role('SCM','ACCOUNTS','FINANCE','ADMIN','LOGISTICS','WAREHOUSE'));

-- po_documents: LOGISTICS uploads BL/K1 (write); WAREHOUSE + LOGISTICS read. Preserve the
-- EXISTS-on-parent-PO structure of the original read policy.
DROP POLICY IF EXISTS pod_read ON public.po_documents;
CREATE POLICY pod_read ON public.po_documents FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_orders po
                 WHERE po.id = po_documents.po_id
                 AND has_role('SCM','ACCOUNTS','FINANCE','ADMIN','WAREHOUSE','LOGISTICS')));

DROP POLICY IF EXISTS pod_write ON public.po_documents;
CREATE POLICY pod_write ON public.po_documents FOR ALL TO authenticated
  USING (has_role('SCM','ACCOUNTS','ADMIN','FINANCE','LOGISTICS'))
  WITH CHECK (has_role('SCM','ACCOUNTS','ADMIN','FINANCE','LOGISTICS'));

-- shipments: LOGISTICS (clearance/ETA) + WAREHOUSE (arrival) write; all workflow roles read.
DROP POLICY IF EXISTS ship_read ON public.shipments;
CREATE POLICY ship_read ON public.shipments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_orders po
                 WHERE po.id = shipments.po_id
                 AND has_role('SCM','ACCOUNTS','FINANCE','ADMIN','WAREHOUSE','LOGISTICS')));

DROP POLICY IF EXISTS ship_write ON public.shipments;
CREATE POLICY ship_write ON public.shipments FOR ALL TO authenticated
  USING (has_role('SCM','ADMIN','LOGISTICS','WAREHOUSE'))
  WITH CHECK (has_role('SCM','ADMIN','LOGISTICS','WAREHOUSE'));

-- shipment_receipts: WAREHOUSE records goods receipt (write); read for SCM/ADMIN/FINANCE/WAREHOUSE/LOGISTICS.
DROP POLICY IF EXISTS sr_read ON public.shipment_receipts;
CREATE POLICY sr_read ON public.shipment_receipts FOR SELECT TO authenticated
  USING (has_role('SCM','ADMIN','FINANCE','WAREHOUSE','LOGISTICS'));

DROP POLICY IF EXISTS sr_write ON public.shipment_receipts;
CREATE POLICY sr_write ON public.shipment_receipts FOR ALL TO authenticated
  USING (has_role('SCM','ADMIN','WAREHOUSE'))
  WITH CHECK (has_role('SCM','ADMIN','WAREHOUSE'));
