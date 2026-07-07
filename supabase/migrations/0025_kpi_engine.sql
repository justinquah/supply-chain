-- ============================================================
-- Migration 0025 — KPI engine: Overstock % / OOS % / Healthy % (2026-07-07)
-- ============================================================
-- Locked definition (REQUIREMENTS-draft.md):
--   OUT_OF_STOCK = stock == 0
--   OVERSTOCK    = stock > 2 × AMS_3mo
--   HEALTHY      = 0 < stock <= 2 × AMS_3mo
--   AMS_3mo      = avg monthly sales (online+offline) over the 3 CALENDAR MONTHS
--                  strictly before the snapshot's month (e.g. a July snapshot → Apr+May+Jun / 3)
--   Eligibility  = (launch_date IS NULL OR launch_date <= snapshot − 6 months) AND is_active
--                  launch_date drives the 6-month new-SKU incubation. NOTE: created_at is the
--                  DB import date (products were bulk-loaded), NOT the real launch, so it is NOT
--                  used — a NULL launch_date means "established / counted"; set a launch_date only
--                  to incubate a genuinely new SKU out of the KPI for its first 6 months.
-- Aggregation: weekly (latest snapshot per product per Monday, KL tz) → monthly (avg of the
--   month's weekly %s) → quarterly (avg of 3 monthly) → FY (avg of the FY's monthly %s).
-- Financial year Oct→Sep. All week bucketing in Asia/Kuala_Lumpur.
-- Only ELIGIBLE products count toward the percentages.
-- ============================================================

-- 1. FY helpers (Oct→Sep) -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fy_of(d date) RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN EXTRACT(MONTH FROM d) >= 10
              THEN EXTRACT(YEAR FROM d)::int
              ELSE EXTRACT(YEAR FROM d)::int - 1 END;
$$;

-- FY quarter: Q1=Oct-Dec, Q2=Jan-Mar, Q3=Apr-Jun, Q4=Jul-Sep
CREATE OR REPLACE FUNCTION fy_quarter_of(d date) RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN EXTRACT(MONTH FROM d) IN (10,11,12) THEN 1
    WHEN EXTRACT(MONTH FROM d) IN (1,2,3)    THEN 2
    WHEN EXTRACT(MONTH FROM d) IN (4,5,6)    THEN 3
    ELSE 4 END;
$$;

-- fy_label(2025) -> 'FY25/26'
CREATE OR REPLACE FUNCTION fy_label(fy_start int) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'FY' || lpad((fy_start % 100)::text, 2, '0') || '/' || lpad(((fy_start + 1) % 100)::text, 2, '0');
$$;

-- 2. Per-(product, week) classification ---------------------------------------------------------
-- One row per product per ISO week (Monday, KL tz), using that week's latest snapshot.
CREATE OR REPLACE VIEW kpi_snapshot AS
WITH snap AS (
  SELECT
    ss.product_id,
    ss.quantity,
    date_trunc('week', (ss.recorded_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::date AS week_start,
    ROW_NUMBER() OVER (
      PARTITION BY ss.product_id, date_trunc('week', (ss.recorded_at AT TIME ZONE 'Asia/Kuala_Lumpur'))
      ORDER BY ss.recorded_at DESC
    ) AS rn
  FROM stock_snapshots ss
),
w AS (
  SELECT
    s.product_id, s.quantity, s.week_start,
    make_date(EXTRACT(YEAR FROM s.week_start)::int, EXTRACT(MONTH FROM s.week_start)::int, 1) AS month_start
  FROM snap s WHERE s.rn = 1
)
SELECT
  w.product_id,
  w.week_start,
  w.quantity AS stock,
  p.sku,
  p.product_family,
  p.is_main,
  COALESCE(ams3.ams, 0) AS ams_3mo,
  ((p.launch_date IS NULL OR p.launch_date <= (w.week_start - INTERVAL '6 months')::date)
    AND p.is_active) AS eligible,
  CASE
    WHEN w.quantity = 0                              THEN 'OOS'
    WHEN w.quantity > 2 * COALESCE(ams3.ams, 0)      THEN 'OVERSTOCK'
    ELSE 'HEALTHY'
  END AS klass
FROM w
JOIN products p ON p.id = w.product_id
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(ms.units_equivalent), 0) / 3.0 AS ams
  FROM monthly_sales ms
  WHERE ms.main_product_id = w.product_id
    AND make_date(ms.year, ms.month, 1) IN (
      (w.month_start - INTERVAL '1 month')::date,
      (w.month_start - INTERVAL '2 months')::date,
      (w.month_start - INTERVAL '3 months')::date
    )
) ams3 ON true
WHERE p.is_main;

-- 3. Weekly KPI (% across ELIGIBLE products in that week) ----------------------------------------
CREATE OR REPLACE VIEW kpi_weekly AS
SELECT
  week_start,
  fy_of(week_start)          AS fy,
  fy_quarter_of(week_start)  AS fy_q,
  EXTRACT(YEAR FROM week_start)::int  AS cal_year,
  EXTRACT(MONTH FROM week_start)::int AS cal_month,
  COUNT(*) FILTER (WHERE eligible) AS eligible_n,
  ROUND(100.0 * COUNT(*) FILTER (WHERE eligible AND klass = 'OOS')
        / NULLIF(COUNT(*) FILTER (WHERE eligible), 0), 1) AS oos_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE eligible AND klass = 'OVERSTOCK')
        / NULLIF(COUNT(*) FILTER (WHERE eligible), 0), 1) AS overstock_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE eligible AND klass = 'HEALTHY')
        / NULLIF(COUNT(*) FILTER (WHERE eligible), 0), 1) AS healthy_pct
FROM kpi_snapshot
GROUP BY week_start;

-- 4. Monthly KPI (avg of the month's weekly %s) --------------------------------------------------
CREATE OR REPLACE VIEW kpi_monthly AS
SELECT
  cal_year, cal_month,
  fy_of(make_date(cal_year, cal_month, 1))         AS fy,
  fy_quarter_of(make_date(cal_year, cal_month, 1)) AS fy_q,
  ROUND(AVG(oos_pct), 1)       AS oos_pct,
  ROUND(AVG(overstock_pct), 1) AS overstock_pct,
  ROUND(AVG(healthy_pct), 1)   AS healthy_pct,
  MAX(eligible_n)              AS eligible_n,
  COUNT(*)                     AS weeks_counted
FROM kpi_weekly
GROUP BY cal_year, cal_month;

-- 5. Quarterly KPI (avg of the quarter's monthly %s) --------------------------------------------
CREATE OR REPLACE VIEW kpi_quarterly AS
SELECT
  fy, fy_q, fy_label(fy) AS fy_label,
  ROUND(AVG(oos_pct), 1)       AS oos_pct,
  ROUND(AVG(overstock_pct), 1) AS overstock_pct,
  ROUND(AVG(healthy_pct), 1)   AS healthy_pct,
  COUNT(*)                     AS months_counted
FROM kpi_monthly
GROUP BY fy, fy_q;

-- 6. FY KPI (avg of the FY's monthly %s) --------------------------------------------------------
CREATE OR REPLACE VIEW kpi_fy AS
SELECT
  fy, fy_label(fy) AS fy_label,
  ROUND(AVG(oos_pct), 1)       AS oos_pct,
  ROUND(AVG(overstock_pct), 1) AS overstock_pct,
  ROUND(AVG(healthy_pct), 1)   AS healthy_pct,
  COUNT(*)                     AS months_counted
FROM kpi_monthly
GROUP BY fy;
