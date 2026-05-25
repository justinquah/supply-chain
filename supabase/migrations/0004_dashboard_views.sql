-- ============================================================
-- Migration 0004 — AMS + dashboard views
-- ============================================================

-- The 3 most recent (year, month) periods present in monthly_sales.
CREATE OR REPLACE VIEW recent_sales_months AS
SELECT year, month
FROM (SELECT DISTINCT year, month FROM monthly_sales ORDER BY year DESC, month DESC LIMIT 3) t;

-- Average monthly sales per product over the latest 3 months, split by channel.
CREATE OR REPLACE VIEW product_ams AS
SELECT
  p.id AS product_id,
  COALESCE(SUM(ms.units_equivalent), 0) / 3.0 AS ams_total,
  COALESCE(SUM(ms.units_equivalent) FILTER (WHERE ms.channel = 'ONLINE'), 0) / 3.0 AS ams_online,
  COALESCE(SUM(ms.units_equivalent) FILTER (WHERE ms.channel = 'OFFLINE'), 0) / 3.0 AS ams_offline
FROM products p
LEFT JOIN monthly_sales ms
  ON ms.main_product_id = p.id
  AND (ms.year, ms.month) IN (SELECT year, month FROM recent_sales_months)
GROUP BY p.id;

-- Combined dashboard row per product: stock + AMS + coverage + incoming.
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
  -- coverage in months (stock ÷ monthly burn). NULL when no sales.
  CASE WHEN ams.ams_total > 0
       THEN COALESCE(ls.quantity, 0) / ams.ams_total
       ELSE NULL END AS coverage_months,
  -- incoming still expected
  COALESCE(inc.incoming_total, 0) AS incoming_total
FROM products p
LEFT JOIN product_categories pc ON pc.id = p.category_id
LEFT JOIN latest_stock ls ON ls.product_id = p.id
LEFT JOIN product_ams ams ON ams.product_id = p.id
LEFT JOIN (
  SELECT product_id, SUM(quantity) AS incoming_total
  FROM incoming_stock WHERE status = 'EXPECTED'
  GROUP BY product_id
) inc ON inc.product_id = p.id;
