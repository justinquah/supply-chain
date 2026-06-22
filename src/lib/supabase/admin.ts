// SERVER-ONLY: This module holds the Supabase service-role (admin) client.
// NEVER import this file from a "use client" component — the SUPABASE_SERVICE_ROLE_KEY
// must never be exposed in the browser bundle (it bypasses ALL Row Level Security).
// Import only from "use server" actions.

import { createClient } from "@supabase/supabase-js";

/**
 * Returns a Supabase admin client using the service-role key.
 * This client bypasses RLS and must be used only in server-side code.
 *
 * The SUPABASE_SERVICE_ROLE_KEY env var must NEVER have a NEXT_PUBLIC_ prefix.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Supabase admin client is not configured. Missing environment variables: " +
        (!url ? "NEXT_PUBLIC_SUPABASE_URL " : "") +
        (!serviceKey ? "SUPABASE_SERVICE_ROLE_KEY" : "")
    );
  }
  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
