-- ============================================================
-- Migration 0052 — second ONLINE sales source: SCommerce (Shopee fulfilment)
-- ============================================================
-- From Oct 2026 Shopee-fulfilled online sales are invoiced to SCommerce Trading
-- Malaysia Sdn Bhd and arrive as their own AutoCount export. They are stored as
-- channel ONLINE, platform 'SCOMMERCE', and uploaded separately from the Qianyi
-- online export — so the upload log now keys on (year, month, channel, source).
-- ============================================================

ALTER TABLE sales_uploads
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'MAIN';

ALTER TABLE sales_uploads DROP CONSTRAINT IF EXISTS sales_uploads_year_month_channel_key;
ALTER TABLE sales_uploads
  ADD CONSTRAINT sales_uploads_year_month_channel_source_key UNIQUE (year, month, channel, source);
