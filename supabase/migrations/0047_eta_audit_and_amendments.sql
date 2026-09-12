-- ============================================================
-- Migration 0047 — ETA change audit + PO amendments + credit notes
-- ============================================================
-- Adds:
--   1. po_eta_changes  — audit row for every ETA-column write on purchase_orders
--   2. po_amendments + po_amendment_lines — quantity/invoice amendments post-issue
--   3. purchase_orders.credit_note_amount + credit_note_number — finance credit note
--   4. doc_type 'CREDIT_NOTE' — credit note document category
-- ============================================================

-- New doc type for supplier credit notes
ALTER TYPE doc_type ADD VALUE IF NOT EXISTS 'CREDIT_NOTE';

-- Credit note fields on the PO itself. Finance sets these when a credit note
-- is attached instead of the supplier issuing a corrected invoice.
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS credit_note_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_note_number TEXT;

-- Effective payable helper: what finance actually pays = invoice_amount - credit_note_amount.
-- Kept as a generated column so downstream queries and views can rely on it.
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS effective_invoice_amount NUMERIC
    GENERATED ALWAYS AS (COALESCE(invoice_amount, 0) - COALESCE(credit_note_amount, 0)) STORED;

-- ------------------------------------------------------------
-- ETA change audit
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS po_eta_changes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id         UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  column_name   TEXT NOT NULL,
    -- 'targeted_eta' | 'supplier_eta' | 'logistics_eta' | 'actual_eta' |
    -- 'eta_to_warehouse' | 'etd'
  old_value     DATE,
  new_value     DATE,
  category      TEXT,
    -- 'SUPPLIER_DELAY' | 'LOGISTICS_DELAY' | 'CUSTOMS_DELAY' |
    -- 'EXPEDITE' | 'CUSTOMER_REQUEST' | 'OTHER'
  reason        TEXT,
  changed_by    UUID REFERENCES profiles(id),
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_po_eta_changes_po ON po_eta_changes(po_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_eta_changes_column ON po_eta_changes(column_name);

ALTER TABLE po_eta_changes ENABLE ROW LEVEL SECURITY;

-- Anyone who can see the PO can read its ETA history.
DROP POLICY IF EXISTS po_eta_changes_read ON po_eta_changes;
CREATE POLICY po_eta_changes_read ON po_eta_changes FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM purchase_orders po
      WHERE po.id = po_eta_changes.po_id
    )
  );

-- Any role that can write a PO ETA can log a change row.
DROP POLICY IF EXISTS po_eta_changes_write ON po_eta_changes;
CREATE POLICY po_eta_changes_write ON po_eta_changes FOR INSERT TO authenticated
  WITH CHECK (
    has_role('SUPER_ADMIN','SCM','ADMIN','LOGISTICS','FINANCE','ACCOUNTS')
    OR (current_user_role() = 'SUPPLIER'
        AND EXISTS (
          SELECT 1 FROM purchase_orders po
          WHERE po.id = po_eta_changes.po_id AND po.supplier_id = auth.uid()
        ))
  );

-- ------------------------------------------------------------
-- PO quantity/invoice amendments
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS po_amendments (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id                    UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  amended_by               UUID REFERENCES profiles(id),
  amended_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason                   TEXT NOT NULL,
  -- The invoice snapshot at the moment of amendment:
  old_invoice_amount       NUMERIC,
  revised_invoice_amount   NUMERIC,
    -- populated when the supplier issued a corrected invoice
  credit_note_expected     BOOLEAN NOT NULL DEFAULT FALSE,
    -- true when the amendment expects a credit note instead of a revised invoice
  notes                    TEXT
);

CREATE INDEX IF NOT EXISTS idx_po_amendments_po ON po_amendments(po_id, amended_at DESC);

CREATE TABLE IF NOT EXISTS po_amendment_lines (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  amendment_id        UUID NOT NULL REFERENCES po_amendments(id) ON DELETE CASCADE,
  incoming_stock_id   UUID REFERENCES incoming_stock(id) ON DELETE SET NULL,
  product_id          UUID REFERENCES products(id),
  old_quantity        NUMERIC,
  new_quantity        NUMERIC
);

CREATE INDEX IF NOT EXISTS idx_po_amendment_lines_amendment
  ON po_amendment_lines(amendment_id);

ALTER TABLE po_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_amendment_lines ENABLE ROW LEVEL SECURITY;

-- Amendments visible to any internal role that sees the PO.
DROP POLICY IF EXISTS po_amendments_read ON po_amendments;
CREATE POLICY po_amendments_read ON po_amendments FOR SELECT TO authenticated
  USING (
    has_role('SUPER_ADMIN','SCM','ADMIN','LOGISTICS','FINANCE','ACCOUNTS','WAREHOUSE','STAFF')
  );

-- Only SCM / ADMIN / FINANCE can amend.
DROP POLICY IF EXISTS po_amendments_write ON po_amendments;
CREATE POLICY po_amendments_write ON po_amendments FOR ALL TO authenticated
  USING (has_role('SUPER_ADMIN','SCM','ADMIN','FINANCE','ACCOUNTS'))
  WITH CHECK (has_role('SUPER_ADMIN','SCM','ADMIN','FINANCE','ACCOUNTS'));

-- Line rows inherit from their parent amendment.
DROP POLICY IF EXISTS po_amendment_lines_read ON po_amendment_lines;
CREATE POLICY po_amendment_lines_read ON po_amendment_lines FOR SELECT TO authenticated
  USING (
    has_role('SUPER_ADMIN','SCM','ADMIN','LOGISTICS','FINANCE','ACCOUNTS','WAREHOUSE','STAFF')
  );

DROP POLICY IF EXISTS po_amendment_lines_write ON po_amendment_lines;
CREATE POLICY po_amendment_lines_write ON po_amendment_lines FOR ALL TO authenticated
  USING (has_role('SUPER_ADMIN','SCM','ADMIN','FINANCE','ACCOUNTS'))
  WITH CHECK (has_role('SUPER_ADMIN','SCM','ADMIN','FINANCE','ACCOUNTS'));
