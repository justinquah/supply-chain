-- ============================================================
-- Migration 0012 — Drop Shopee integration tables
--
-- APPEND-ONLY: do NOT edit past migrations (0001–0011).
--
-- Background: migration 0010 created the `integration_tokens` and
-- `sync_log` tables for the Shopee OAuth/stock-sync feature. That
-- feature has been removed from the codebase (Phase 1, D-11). No
-- live code imports from or writes to these tables any longer.
-- `sync_log` was Shopee-specific (provider = 'SHOPEE'); dropping it
-- now keeps the schema clean. A general audit/job log can be added
-- as a new migration if needed in a future phase.
--
-- Dropping a table automatically drops its RLS policies and any
-- indexes defined on it, so no explicit policy/index drops are needed.
-- ============================================================

DROP TABLE IF EXISTS integration_tokens CASCADE;
DROP TABLE IF EXISTS sync_log CASCADE;
