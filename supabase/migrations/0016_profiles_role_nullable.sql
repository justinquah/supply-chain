-- ============================================================
-- Migration 0016 — make profiles.role nullable (robust user creation)
-- ============================================================
-- The 0011 handle_new_user trigger inserts role from raw_user_meta_data->>'role'. Supabase
-- GoTrue's admin *createUser* (and some invite paths) persist user_metadata in a second write,
-- so the AFTER-INSERT trigger can fire before the role is present → the NOT NULL on profiles.role
-- aborts the insert with "Database error creating new user" (500). That silently breaks the Admin
-- user-management invite flow (AUTH-03) too.
--
-- Fix: allow a NULL role. A profile with NULL role has NO app access — requireRole() excludes it
-- and every gated page bounces them — until an ADMIN assigns a role (via Settings) or the app
-- sets it explicitly after invite. This is safe (fail-closed) and unbreaks user creation.
-- ============================================================

ALTER TABLE public.profiles ALTER COLUMN role DROP NOT NULL;

-- Also make handle_new_user bullet-proof: GoTrue's admin createUser / invite can fire the
-- AFTER-INSERT trigger before user_metadata (the role) is populated, and a bad/empty role string
-- would raise on the enum cast — either way GoTrue returns a 500 "Database error creating new user".
-- Guard the cast, tolerate a missing role (NULL — fail-closed, no access until assigned), and never
-- let the trigger abort user creation. The app (Admin invite / role change) assigns the real role.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE r public.user_role;
BEGIN
  BEGIN
    r := NULLIF(NEW.raw_user_meta_data->>'role', '')::public.user_role;
  EXCEPTION WHEN others THEN r := NULL;
  END;
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'name', NEW.email), r)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;  -- never block auth user creation on a profile-insert hiccup
END;
$fn$;
