-- ============================================================
-- Migration 0041 — Demand-weighted OOS % (2026-07-23)
-- ============================================================
-- The original OOS % is a plain SKU-count share: every SKU is worth the same
-- 1/eligible_n, so a best-seller stocking out moves the number exactly as much
-- as a tail SKU. The demand-weighted version answers "what % of monthly demand
-- cannot be fulfilled right now":
--
--   oos_weighted_pct = Σ ams_3mo of OOS eligible SKUs / Σ ams_3mo of eligible SKUs
--
-- Weighted by UNITS (AMS), deliberately not by value — unit weights are immune
-- to the cost-price data issues that previously inflated inventory value.
-- SKUs with zero AMS carry no weight (no demand, no revenue at risk).
-- Both figures are kept: SKU-count OOS is the discipline check on the tail,
-- weighted OOS is the headline and feeds the score's Availability pillar.
--
-- Columns are APPENDED so CREATE OR REPLACE VIEW is valid against dependants.
-- ============================================================

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
        / NULLIF(COUNT(*) FILTER (WHERE eligible), 0), 1) AS healthy_pct,
  ROUND(100.0 * COALESCE(SUM(ams_3mo) FILTER (WHERE eligible AND klass = 'OOS'), 0)
        / NULLIF(SUM(ams_3mo) FILTER (WHERE eligible), 0), 1) AS oos_weighted_pct
FROM kpi_snapshot
GROUP BY week_start;

CREATE OR REPLACE VIEW kpi_monthly AS
SELECT
  cal_year, cal_month,
  fy_of(make_date(cal_year, cal_month, 1))         AS fy,
  fy_quarter_of(make_date(cal_year, cal_month, 1)) AS fy_q,
  ROUND(AVG(oos_pct), 1)       AS oos_pct,
  ROUND(AVG(overstock_pct), 1) AS overstock_pct,
  ROUND(AVG(healthy_pct), 1)   AS healthy_pct,
  MAX(eligible_n)              AS eligible_n,
  COUNT(*)                     AS weeks_counted,
  ROUND(AVG(oos_weighted_pct), 1) AS oos_weighted_pct
FROM kpi_weekly
GROUP BY cal_year, cal_month;

CREATE OR REPLACE VIEW kpi_quarterly AS
SELECT
  fy, fy_q, fy_label(fy) AS fy_label,
  ROUND(AVG(oos_pct), 1)       AS oos_pct,
  ROUND(AVG(overstock_pct), 1) AS overstock_pct,
  ROUND(AVG(healthy_pct), 1)   AS healthy_pct,
  COUNT(*)                     AS months_counted,
  ROUND(AVG(oos_weighted_pct), 1) AS oos_weighted_pct
FROM kpi_monthly
GROUP BY fy, fy_q;

CREATE OR REPLACE VIEW kpi_fy AS
SELECT
  fy, fy_label(fy) AS fy_label,
  ROUND(AVG(oos_pct), 1)       AS oos_pct,
  ROUND(AVG(overstock_pct), 1) AS overstock_pct,
  ROUND(AVG(healthy_pct), 1)   AS healthy_pct,
  COUNT(*)                     AS months_counted,
  ROUND(AVG(oos_weighted_pct), 1) AS oos_weighted_pct
FROM kpi_monthly
GROUP BY fy;
