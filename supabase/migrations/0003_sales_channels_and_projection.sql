-- ============================================================
-- Migration 0003 — Sales channels, incoming stock, payment terms
-- ============================================================

-- Sales channel enum
DO $$ BEGIN
  CREATE TYPE sales_channel AS ENUM ('ONLINE','OFFLINE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- monthly_sales: add channel + platform
ALTER TABLE monthly_sales
  ADD COLUMN IF NOT EXISTS channel  sales_channel,
  ADD COLUMN IF NOT EXISTS platform TEXT;

CREATE INDEX IF NOT EXISTS idx_monthly_sales_channel ON monthly_sales(channel);
CREATE INDEX IF NOT EXISTS idx_monthly_sales_ym_channel ON monthly_sales(year, month, channel);

-- products: payment terms
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS payment_terms TEXT;  -- e.g. "30% deposit on PO, 70% balance before shipment"

-- ---- incoming_stock: expected arrivals feeding the projection ----
-- For now entered manually by supply chain; later auto-populated from issued POs/shipments.
CREATE TABLE IF NOT EXISTS incoming_stock (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity        INT NOT NULL,                 -- in main-product units
  expected_date   DATE NOT NULL,                -- when it should arrive
  po_id           UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  shipment_id     UUID REFERENCES shipments(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'EXPECTED',  -- EXPECTED, ARRIVED, CANCELLED
  notes           TEXT,
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_incoming_stock_product ON incoming_stock(product_id);
CREATE INDEX IF NOT EXISTS idx_incoming_stock_date ON incoming_stock(expected_date);
DROP TRIGGER IF EXISTS incoming_stock_updated_at ON incoming_stock;
CREATE TRIGGER incoming_stock_updated_at BEFORE UPDATE ON incoming_stock
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE incoming_stock ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inc_read ON incoming_stock;
CREATE POLICY inc_read ON incoming_stock FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS inc_write ON incoming_stock;
CREATE POLICY inc_write ON incoming_stock FOR ALL TO authenticated
  USING (has_role('SUPER_ADMIN','SCM','ADMIN','LOGISTICS'))
  WITH CHECK (has_role('SUPER_ADMIN','SCM','ADMIN','LOGISTICS'));

-- ---- sales_uploads: track which monthly files have been loaded ----
CREATE TABLE IF NOT EXISTS sales_uploads (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  year          INT NOT NULL,
  month         INT NOT NULL,
  channel       sales_channel NOT NULL,
  file_name     TEXT,
  rows_imported INT,
  units_total   NUMERIC,
  uploaded_by   UUID REFERENCES profiles(id),
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (year, month, channel)
);
ALTER TABLE sales_uploads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS su_read ON sales_uploads;
CREATE POLICY su_read ON sales_uploads FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS su_write ON sales_uploads;
CREATE POLICY su_write ON sales_uploads FOR ALL TO authenticated
  USING (has_role('SUPER_ADMIN','SCM','ADMIN'))
  WITH CHECK (has_role('SUPER_ADMIN','SCM','ADMIN'));

-- Make monthly_sales readable by everyone (all authenticated) for the shared dashboard
DROP POLICY IF EXISTS sales_read ON monthly_sales;
CREATE POLICY sales_read ON monthly_sales FOR SELECT TO authenticated USING (true);

-- stock_snapshots readable by all authenticated too
DROP POLICY IF EXISTS stock_read ON stock_snapshots;
CREATE POLICY stock_read ON stock_snapshots FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS stock_write ON stock_snapshots;
CREATE POLICY stock_write ON stock_snapshots FOR ALL TO authenticated
  USING (has_role('SUPER_ADMIN','SCM','ADMIN'))
  WITH CHECK (has_role('SUPER_ADMIN','SCM','ADMIN'));

-- ---- latest_stock view: most recent snapshot per product ----
CREATE OR REPLACE VIEW latest_stock AS
SELECT DISTINCT ON (product_id)
  product_id, quantity, source, recorded_at
FROM stock_snapshots
ORDER BY product_id, recorded_at DESC;
