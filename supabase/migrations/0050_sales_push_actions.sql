-- ============================================================
-- Migration 0050 — sales-push actions on overstocked products
-- ============================================================
-- The SCM logs what the sales teams did to move overstocked stock:
--   ONLINE  → VOUCHER / ADS_SPEND / DISCOUNT
--   OFFLINE → TRADE_OFFER
-- One row per product (a multi-product log shares a batch_id). measure_year/
-- measure_month is fixed at log time from the start date (on/before the 15th →
-- that month, later → the next month). Results are evaluated live in the app
-- against monthly_sales once that month's sales for the channel are loaded.
-- ============================================================

CREATE TABLE IF NOT EXISTS sales_push_actions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id            UUID NOT NULL,
  product_id          UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  channel             sales_channel NOT NULL,
  mechanic            TEXT NOT NULL,
  details             TEXT,
  cost_myr            NUMERIC CHECK (cost_myr IS NULL OR cost_myr >= 0),
  start_date          DATE NOT NULL,
  end_date            DATE,
  measure_year        INT NOT NULL,
  measure_month       INT NOT NULL CHECK (measure_month BETWEEN 1 AND 12),
  coverage_at_action  NUMERIC,
  created_by          UUID REFERENCES profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK (
    (channel = 'ONLINE'  AND mechanic IN ('VOUCHER', 'ADS_SPEND', 'DISCOUNT')) OR
    (channel = 'OFFLINE' AND mechanic = 'TRADE_OFFER')
  )
);

CREATE INDEX IF NOT EXISTS idx_sales_push_product ON sales_push_actions(product_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_push_start ON sales_push_actions(start_date DESC);

ALTER TABLE sales_push_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_push_read ON sales_push_actions;
CREATE POLICY sales_push_read ON sales_push_actions FOR SELECT TO authenticated
  USING (has_role('SCM', 'ADMIN', 'WAREHOUSE', 'LOGISTICS', 'FINANCE', 'ACCOUNTS', 'STAFF'));

DROP POLICY IF EXISTS sales_push_write ON sales_push_actions;
CREATE POLICY sales_push_write ON sales_push_actions FOR ALL TO authenticated
  USING (has_role('SCM', 'ADMIN'))
  WITH CHECK (has_role('SCM', 'ADMIN'));

REVOKE ALL ON sales_push_actions FROM anon;

-- Which (year, month, channel) sales have been keyed in. security_invoker so
-- it honours monthly_sales RLS; anon revoked (see migration 0049).
CREATE OR REPLACE VIEW sales_months_loaded WITH (security_invoker = true) AS
  SELECT DISTINCT year, month, channel
  FROM monthly_sales
  WHERE channel IS NOT NULL;

REVOKE ALL ON sales_months_loaded FROM anon;
