-- ============================================================
-- Migration 0005 — FX rates, inventory value, KPIs, weekly health
-- ============================================================

-- FX rates to MYR (editable by SCM/admin). Used to value multi-currency costs.
CREATE TABLE IF NOT EXISTS fx_rates (
  currency     currency_code PRIMARY KEY,
  rate_to_myr  NUMERIC NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO fx_rates (currency, rate_to_myr) VALUES
  ('MYR', 1.00), ('USD', 4.70), ('CNY', 0.65), ('THB', 0.13)
ON CONFLICT (currency) DO UPDATE SET rate_to_myr = EXCLUDED.rate_to_myr, updated_at = NOW();

ALTER TABLE fx_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fx_read ON fx_rates;
CREATE POLICY fx_read ON fx_rates FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS fx_write ON fx_rates;
CREATE POLICY fx_write ON fx_rates FOR ALL TO authenticated
  USING (has_role('SUPER_ADMIN','SCM','ADMIN','FINANCE'))
  WITH CHECK (has_role('SUPER_ADMIN','SCM','ADMIN','FINANCE'));

-- Rebuild product_dashboard to include cost + inventory value in MYR.
CREATE OR REPLACE VIEW product_dashboard AS
SELECT
  p.id,
  p.sku,
  p.name,
  p.variation,
  p.product_family,
  p.is_main,
  p.is_active,
  pc.name AS category,
  COALESCE(ls.quantity, 0) AS current_stock,
  ams.ams_total,
  ams.ams_online,
  ams.ams_offline,
  CASE WHEN ams.ams_total > 0
       THEN COALESCE(ls.quantity, 0) / ams.ams_total
       ELSE NULL END AS coverage_months,
  COALESCE(inc.incoming_total, 0) AS incoming_total,
  p.unit_cost,
  p.cost_currency,
  p.unit_cost * COALESCE(fx.rate_to_myr, 1) AS unit_cost_myr,
  COALESCE(ls.quantity, 0) * COALESCE(p.unit_cost, 0) * COALESCE(fx.rate_to_myr, 1) AS inventory_value_myr,
  ams.ams_total * COALESCE(p.unit_cost, 0) * COALESCE(fx.rate_to_myr, 1) AS monthly_sales_value_myr
FROM products p
LEFT JOIN product_categories pc ON pc.id = p.category_id
LEFT JOIN latest_stock ls ON ls.product_id = p.id
LEFT JOIN product_ams ams ON ams.product_id = p.id
LEFT JOIN (
  SELECT product_id, SUM(quantity) AS incoming_total
  FROM incoming_stock WHERE status = 'EXPECTED'
  GROUP BY product_id
) inc ON inc.product_id = p.id
LEFT JOIN fx_rates fx ON fx.currency = p.cost_currency;

-- Weekly inventory health: latest snapshot per product per ISO week, valued in MYR.
CREATE OR REPLACE VIEW inventory_weekly AS
WITH snap AS (
  SELECT
    ss.product_id,
    ss.quantity,
    date_trunc('week', ss.recorded_at)::date AS week_start,
    ROW_NUMBER() OVER (
      PARTITION BY ss.product_id, date_trunc('week', ss.recorded_at)
      ORDER BY ss.recorded_at DESC
    ) AS rn
  FROM stock_snapshots ss
)
SELECT
  s.week_start,
  SUM(s.quantity)::bigint AS total_units,
  SUM(s.quantity * COALESCE(p.unit_cost, 0) * COALESCE(fx.rate_to_myr, 1)) AS inventory_value_myr,
  COUNT(DISTINCT s.product_id) AS products_counted
FROM snap s
JOIN products p ON p.id = s.product_id
LEFT JOIN fx_rates fx ON fx.currency = p.cost_currency
WHERE s.rn = 1
GROUP BY s.week_start
ORDER BY s.week_start;
