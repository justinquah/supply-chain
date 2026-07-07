-- ============================================================
-- Migration 0026 — Dashboard: value stock at the LATEST snapshot, not the sales month (2026-07-07)
-- ============================================================
-- Bug: product_dashboard_asof(y,m) tied BOTH the AMS window AND the stock figure to the
-- selected month. Stock uploads (weekly) outpace sales uploads (monthly), so when the latest
-- sales month (e.g. May) is older than the latest stock snapshot (e.g. 29 Jun), the dashboard
-- showed the OLDER month-end stock (17 May, RM 1.17M) while labelling it with the newest
-- snapshot date (29 Jun) — a stale, mislabelled inventory value.
--
-- Fix: the AMS window stays "3 months ending (p_year,p_month)", but STOCK is now always the
-- latest snapshot per product (current inventory). Historical stock browsing lives in the
-- weekly inventory chart; the dashboard's job is current inventory + selected-month AMS.
-- Value uses the primary-supplier cost + FX (unchanged from 0022).
-- ============================================================

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
  -- STOCK = latest snapshot per product (current inventory), NOT bounded by the sales month.
  stock AS (
    SELECT DISTINCT ON (product_id) product_id, quantity
    FROM stock_snapshots
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
