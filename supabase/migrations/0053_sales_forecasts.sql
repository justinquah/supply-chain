-- ============================================================
-- Migration 0053 — saved sales forecasts (for accuracy tracking)
-- ============================================================
-- One snapshot per base month (the last complete month of sales the forecast
-- used): each active product × channel × next 1–3 months. Snapshots are kept
-- once the next month's sales arrive, so later actuals can be compared with
-- what was forecast at the time. is_backfill = made after the fact from
-- history up to its base month (a back-test), not saved live at the time.
-- ============================================================

CREATE TABLE IF NOT EXISTS sales_forecasts (
  id              BIGSERIAL PRIMARY KEY,
  base_year       INT      NOT NULL,
  base_month      INT      NOT NULL CHECK (base_month BETWEEN 1 AND 12),
  target_year     INT      NOT NULL,
  target_month    INT      NOT NULL CHECK (target_month BETWEEN 1 AND 12),
  horizon         SMALLINT NOT NULL CHECK (horizon BETWEEN 1 AND 3),
  product_id      UUID     NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  channel         TEXT     NOT NULL CHECK (channel IN ('ONLINE', 'OFFLINE')),
  forecast_units  NUMERIC  NOT NULL,
  baseline_units  NUMERIC  NOT NULL,
  method          TEXT     NOT NULL,
  backtest_error  NUMERIC,
  model_version   TEXT     NOT NULL DEFAULT 'v1',
  is_backfill     BOOLEAN  NOT NULL DEFAULT false,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (base_year, base_month, product_id, channel, horizon)
);

CREATE INDEX IF NOT EXISTS sales_forecasts_target_idx
  ON sales_forecasts (target_year, target_month);

ALTER TABLE sales_forecasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_forecasts_read ON sales_forecasts;
CREATE POLICY sales_forecasts_read ON sales_forecasts FOR SELECT TO authenticated
  USING (has_role('SCM', 'ADMIN', 'WAREHOUSE', 'LOGISTICS', 'FINANCE', 'ACCOUNTS'));

DROP POLICY IF EXISTS sales_forecasts_write ON sales_forecasts;
CREATE POLICY sales_forecasts_write ON sales_forecasts FOR ALL TO authenticated
  USING (has_role('SCM', 'ADMIN'))
  WITH CHECK (has_role('SCM', 'ADMIN'));

REVOKE ALL ON sales_forecasts FROM anon;
REVOKE ALL ON SEQUENCE sales_forecasts_id_seq FROM anon;

-- Which snapshots exist (cheap lookup instead of reading every row).
CREATE OR REPLACE VIEW sales_forecast_bases
WITH (security_invoker = true) AS
SELECT base_year,
       base_month,
       bool_and(is_backfill) AS is_backfill,
       max(generated_at)     AS generated_at,
       count(*)::int         AS row_count
FROM sales_forecasts
GROUP BY base_year, base_month;

REVOKE ALL ON sales_forecast_bases FROM anon;
