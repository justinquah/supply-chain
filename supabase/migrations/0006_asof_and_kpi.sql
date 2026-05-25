-- ============================================================
-- Migration 0006 — "as of month" dashboard function + monthly KPI view
-- ============================================================

-- Dashboard as of a given month: AMS = 3 months ending (p_year,p_month);
-- stock = latest snapshot on/before end of that month.
CREATE OR REPLACE FUNCTION product_dashboard_asof(p_year int, p_month int)
RETURNS TABLE (
  id uuid, sku text, name text, variation text, product_family text,
  is_main boolean, is_active boolean, category text,
  current_stock numeric, ams_total numeric, ams_online numeric, ams_offline numeric,
  coverage_months numeric, incoming_total numeric,
  unit_cost numeric, cost_currency currency_code, unit_cost_myr numeric,
  inventory_value_myr numeric, monthly_sales_value_myr numeric
) AS $$
  WITH wm AS (
    SELECT EXTRACT(YEAR FROM d)::int AS y, EXTRACT(MONTH FROM d)::int AS m
    FROM generate_series(0, 2) n
    CROSS JOIN LATERAL (
      SELECT (make_date(p_year, p_month, 1) - (n || ' month')::interval)::date AS d
    ) x
  ),
  ams AS (
    SELECT p.id AS pid,
      COALESCE(SUM(ms.units_equivalent), 0) / 3.0 AS at,
      COALESCE(SUM(ms.units_equivalent) FILTER (WHERE ms.channel = 'ONLINE'), 0) / 3.0 AS ao,
      COALESCE(SUM(ms.units_equivalent) FILTER (WHERE ms.channel = 'OFFLINE'), 0) / 3.0 AS af
    FROM products p
    LEFT JOIN monthly_sales ms
      ON ms.main_product_id = p.id AND (ms.year, ms.month) IN (SELECT y, m FROM wm)
    GROUP BY p.id
  ),
  stock AS (
    SELECT DISTINCT ON (product_id) product_id, quantity
    FROM stock_snapshots
    WHERE recorded_at::date <= (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date
    ORDER BY product_id, recorded_at DESC
  )
  SELECT
    p.id, p.sku, p.name, p.variation, p.product_family, p.is_main, p.is_active,
    pc.name,
    COALESCE(s.quantity, 0)::numeric,
    a.at, a.ao, a.af,
    CASE WHEN a.at > 0 THEN COALESCE(s.quantity, 0) / a.at ELSE NULL END,
    COALESCE(inc.t, 0),
    p.unit_cost, p.cost_currency, p.unit_cost * COALESCE(fx.rate_to_myr, 1),
    COALESCE(s.quantity, 0) * COALESCE(p.unit_cost, 0) * COALESCE(fx.rate_to_myr, 1),
    a.at * COALESCE(p.unit_cost, 0) * COALESCE(fx.rate_to_myr, 1)
  FROM products p
  LEFT JOIN product_categories pc ON pc.id = p.category_id
  LEFT JOIN ams a ON a.pid = p.id
  LEFT JOIN stock s ON s.product_id = p.id
  LEFT JOIN (
    SELECT product_id, SUM(quantity) AS t FROM incoming_stock WHERE status = 'EXPECTED' GROUP BY product_id
  ) inc ON inc.product_id = p.id
  LEFT JOIN fx_rates fx ON fx.currency = p.cost_currency;
$$ LANGUAGE sql STABLE;

-- Monthly KPI rollup: units + sales value at cost per channel, per month.
CREATE OR REPLACE VIEW monthly_kpi AS
SELECT
  ms.year,
  ms.month,
  SUM(ms.units_equivalent) AS units_total,
  SUM(ms.units_equivalent) FILTER (WHERE ms.channel = 'ONLINE') AS units_online,
  SUM(ms.units_equivalent) FILTER (WHERE ms.channel = 'OFFLINE') AS units_offline,
  SUM(ms.units_equivalent * COALESCE(p.unit_cost, 0) * COALESCE(fx.rate_to_myr, 1)) AS sales_value_myr,
  SUM(ms.units_equivalent * COALESCE(p.unit_cost, 0) * COALESCE(fx.rate_to_myr, 1))
    FILTER (WHERE ms.channel = 'ONLINE') AS sales_value_online_myr,
  SUM(ms.units_equivalent * COALESCE(p.unit_cost, 0) * COALESCE(fx.rate_to_myr, 1))
    FILTER (WHERE ms.channel = 'OFFLINE') AS sales_value_offline_myr
FROM monthly_sales ms
JOIN products p ON p.id = ms.main_product_id
LEFT JOIN fx_rates fx ON fx.currency = p.cost_currency
GROUP BY ms.year, ms.month
ORDER BY ms.year, ms.month;
