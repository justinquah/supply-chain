-- ============================================================
-- Migration 0049 — close public (anon) read access on views
-- ============================================================
-- Views run with their owner's rights, so they bypass the RLS on the tables
-- underneath. Supabase also grants SELECT on new objects to `anon`, the role
-- used by the public anon key that ships in the browser bundle. Together that
-- let anyone holding the anon key read product_dashboard (costs, inventory
-- value), monthly_kpi, KPI views, v_po_balance, etc. WITHOUT logging in.
--
-- The app reads every view as a signed-in user (role `authenticated`), so
-- removing anon's access changes nothing for logged-in users.
-- Applies to every view / materialized view in `public`, including any added
-- before this ran. New views must also REVOKE ... FROM anon (or set
-- security_invoker = true) — Supabase's default privileges grant it again.
-- ============================================================

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', r.relname);
  END LOOP;
END $$;
