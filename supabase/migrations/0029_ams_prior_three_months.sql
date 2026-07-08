-- ============================================================
-- Migration 0029 — Dashboard AMS = the 3 CALENDAR MONTHS BEFORE the stock week (2026-07-08)
-- ============================================================
-- Bug: product_dashboard_asof_date computed AMS over "3 months ending the month of the stock
-- date" (inclusive), so a 7 Jul stock view averaged May+Jun+Jul — and July is the current,
-- incomplete month (often zero sales), understating AMS. It also disagreed with the KPI engine,
-- which uses the 3 months strictly before the snapshot (M-1, M-2, M-3).
-- Fix: AMS window = (month of p_date) minus 1, 2, 3 → a 7 Jul view averages Apr+May+Jun.
-- Only the `wm` CTE changes (generate_series(1,3) instead of (0,2)); everything else identical.
-- ============================================================

CREATE OR REPLACE FUNCTION product_dashboard_asof_date(p_date date)
RETURNS TABLE (
  id uuid, sku text, name text, variation text, product_family text,
  is_main boolean, is_active boolean, category text,
  current_stock numeric, ams_total numeric, ams_online numeric, ams_offline numeric,
  coverage_months numeric, incoming_total numeric,
  unit_cost numeric, cost_currency currency_code, unit_cost_myr numeric,
  inventory_value_myr numeric, monthly_sales_value_myr numeric
) AS $$
  WITH wm AS (
    -- the 3 calendar months strictly BEFORE the month of p_date (M-1, M-2, M-3)
    SELECT EXTRACT(YEAR FROM d)::int AS y, EXTRACT(MONTH FROM d)::int AS m
    FROM generate_series(1, 3) n
    CROSS JOIN LATERAL (
      SELECT (date_trunc('month', p_date) - (n || ' month')::interval)::date AS d
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
    WHERE (recorded_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date <= p_date
    ORDER BY product_id, recorded_at DESC
  )
  SELECT
    p.id, p.sku, p.name, p.variation, p.product_family, p.is_main, p.is_active,
    pc.name,
    COALESCE(s.quantity, 0)::numeric,
    a.at, a.ao, a.af,
    CASE WHEN a.at > 0 THEN COALESCE(s.quantity, 0) / a.at ELSE NULL END,
    COALESCE(inc.t, 0),
    COALESCE(psup.unit_cost, p.unit_cost),
    COALESCE(psup.cost_currency, p.cost_currency),
    COALESCE(psup.unit_cost, p.unit_cost) * COALESCE(fx.rate_to_myr, 1),
    COALESCE(s.quantity, 0) * COALESCE(COALESCE(psup.unit_cost, p.unit_cost), 0) * COALESCE(fx.rate_to_myr, 1),
    a.at * COALESCE(COALESCE(psup.unit_cost, p.unit_cost), 0) * COALESCE(fx.rate_to_myr, 1)
  FROM products p
  LEFT JOIN product_categories pc ON pc.id = p.category_id
  LEFT JOIN ams a ON a.pid = p.id
  LEFT JOIN stock s ON s.product_id = p.id
  LEFT JOIN (
    SELECT product_id, SUM(quantity) AS t FROM incoming_stock WHERE status = 'EXPECTED' GROUP BY product_id
  ) inc ON inc.product_id = p.id
  LEFT JOIN LATERAL (
    SELECT ps.unit_cost, ps.cost_currency
    FROM product_suppliers ps
    WHERE ps.product_id = p.id
    ORDER BY ps.is_primary DESC NULLS LAST, ps.unit_cost ASC
    LIMIT 1
  ) psup ON true
  LEFT JOIN fx_rates fx ON fx.currency = COALESCE(psup.cost_currency, p.cost_currency);
$$ LANGUAGE sql STABLE;
