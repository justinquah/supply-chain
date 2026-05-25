-- ============================================================
-- Migration 0010 — integration tokens (Shopee OAuth) + sync log
-- ============================================================

CREATE TABLE IF NOT EXISTS integration_tokens (
  provider      TEXT PRIMARY KEY,          -- 'SHOPEE'
  access_token  TEXT,
  refresh_token TEXT,
  shop_id       TEXT,
  shop_name     TEXT,
  environment   TEXT,                       -- 'sandbox' | 'live'
  expires_at    TIMESTAMPTZ,                -- access token expiry
  extra         JSONB,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE integration_tokens ENABLE ROW LEVEL SECURITY;
-- Tokens are sensitive — restrict to admin roles only.
DROP POLICY IF EXISTS it_all ON integration_tokens;
CREATE POLICY it_all ON integration_tokens FOR ALL TO authenticated
  USING (has_role('SUPER_ADMIN','SCM','ADMIN'))
  WITH CHECK (has_role('SUPER_ADMIN','SCM','ADMIN'));

CREATE TABLE IF NOT EXISTS sync_log (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider     TEXT NOT NULL,
  kind         TEXT NOT NULL,               -- 'STOCK', 'AUTH'
  status       TEXT NOT NULL,               -- 'OK', 'ERROR'
  items_synced INT,
  matched      INT,
  unmatched    INT,
  message      TEXT,
  run_by       UUID REFERENCES profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sl_read ON sync_log;
CREATE POLICY sl_read ON sync_log FOR SELECT TO authenticated
  USING (has_role('SUPER_ADMIN','SCM','ADMIN'));
DROP POLICY IF EXISTS sl_write ON sync_log;
CREATE POLICY sl_write ON sync_log FOR ALL TO authenticated
  USING (has_role('SUPER_ADMIN','SCM','ADMIN'))
  WITH CHECK (has_role('SUPER_ADMIN','SCM','ADMIN'));
