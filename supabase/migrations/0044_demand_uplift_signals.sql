-- ============================================================
-- Migration 0044 — Demand uplift signals (2026-07-27)
-- ============================================================
-- The build plans on trailing averages (AMS), so a real demand shift is only
-- absorbed months later. When a product's last completed month runs >= +20%
-- above the average of the 3 months before it (per channel), the Insights tab
-- raises a callout: SCM checks with the Online/Offline team whether it is a
-- short-term uplift (promo/campaign — do not overreact) or a long-term uplift
-- (raise the stock plan). This table stores the verdicts; detection itself is
-- computed live from monthly_sales, so nothing here goes stale.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.demand_signals (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id  UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  -- The spiking month being reviewed (first of month) and the channel.
  period      DATE NOT NULL,
  channel     TEXT NOT NULL CHECK (channel IN ('ONLINE','OFFLINE')),
  uplift_pct  NUMERIC NOT NULL,             -- as detected when resolved, e.g. 34.2
  resolution  TEXT NOT NULL CHECK (resolution IN ('SHORT_TERM','LONG_TERM')),
  note        TEXT,                          -- what the sales team said
  resolved_by UUID REFERENCES public.profiles(id),
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, period, channel)
);

ALTER TABLE public.demand_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ds_read ON public.demand_signals;
CREATE POLICY ds_read ON public.demand_signals FOR SELECT TO authenticated
  USING (has_role('SCM','ADMIN','WAREHOUSE','LOGISTICS'));
DROP POLICY IF EXISTS ds_write ON public.demand_signals;
CREATE POLICY ds_write ON public.demand_signals FOR ALL TO authenticated
  USING (has_role('SCM','ADMIN')) WITH CHECK (has_role('SCM','ADMIN'));
