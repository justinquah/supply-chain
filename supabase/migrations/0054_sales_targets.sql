-- ============================================================
-- Migration 0054 — monthly sales targets
-- ============================================================
-- sales_channel_targets: overall units target per month per channel.
-- sales_focus_targets:   the month's focus products, each with its own
--                        online / offline units target (either may be
--                        blank) and a review note for the team meeting.
-- Read: internal roles. Write: SCM / ADMIN. anon revoked.
-- ============================================================

CREATE TABLE IF NOT EXISTS sales_channel_targets (
  id            BIGSERIAL PRIMARY KEY,
  year          INT     NOT NULL,
  month         INT     NOT NULL CHECK (month BETWEEN 1 AND 12),
  channel       TEXT    NOT NULL CHECK (channel IN ('ONLINE', 'OFFLINE')),
  target_units  NUMERIC NOT NULL CHECK (target_units >= 0),
  updated_by    UUID    REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (year, month, channel)
);

CREATE TABLE IF NOT EXISTS sales_focus_targets (
  id              BIGSERIAL PRIMARY KEY,
  year            INT     NOT NULL,
  month           INT     NOT NULL CHECK (month BETWEEN 1 AND 12),
  product_id      UUID    NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  online_target   NUMERIC CHECK (online_target >= 0),
  offline_target  NUMERIC CHECK (offline_target >= 0),
  review_note     TEXT,
  updated_by      UUID    REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (year, month, product_id)
);

ALTER TABLE sales_channel_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_focus_targets   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_channel_targets_read ON sales_channel_targets;
CREATE POLICY sales_channel_targets_read ON sales_channel_targets FOR SELECT TO authenticated
  USING (has_role('SCM', 'ADMIN', 'WAREHOUSE', 'LOGISTICS', 'FINANCE', 'ACCOUNTS'));
DROP POLICY IF EXISTS sales_channel_targets_write ON sales_channel_targets;
CREATE POLICY sales_channel_targets_write ON sales_channel_targets FOR ALL TO authenticated
  USING (has_role('SCM', 'ADMIN'))
  WITH CHECK (has_role('SCM', 'ADMIN'));

DROP POLICY IF EXISTS sales_focus_targets_read ON sales_focus_targets;
CREATE POLICY sales_focus_targets_read ON sales_focus_targets FOR SELECT TO authenticated
  USING (has_role('SCM', 'ADMIN', 'WAREHOUSE', 'LOGISTICS', 'FINANCE', 'ACCOUNTS'));
DROP POLICY IF EXISTS sales_focus_targets_write ON sales_focus_targets;
CREATE POLICY sales_focus_targets_write ON sales_focus_targets FOR ALL TO authenticated
  USING (has_role('SCM', 'ADMIN'))
  WITH CHECK (has_role('SCM', 'ADMIN'));

REVOKE ALL ON sales_channel_targets FROM anon;
REVOKE ALL ON sales_focus_targets FROM anon;
REVOKE ALL ON SEQUENCE sales_channel_targets_id_seq FROM anon;
REVOKE ALL ON SEQUENCE sales_focus_targets_id_seq FROM anon;
