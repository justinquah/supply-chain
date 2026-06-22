// Server-side Supabase client for Server Components, Route Handlers, and Server Actions.
// Cookies are async in Next.js 16+ — note the `await cookies()`.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/** The four canonical application roles. */
export type AppRole = "SCM" | "ACCOUNTS" | "FINANCE" | "ADMIN";

export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Missing environment variables: " +
        (!url ? "NEXT_PUBLIC_SUPABASE_URL " : "") +
        (!key ? "NEXT_PUBLIC_SUPABASE_ANON_KEY" : "")
    );
  }
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Setting cookies from a Server Component throws — safe to ignore
          // because middleware/proxy refreshes the session for us.
        }
      },
    },
  });
}

// Helper: get the current authenticated user's profile (with role) from the server.
// Returns null if not signed in. Cached at the request level by Supabase under the hood.
export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, name, role, company_name, is_active")
    .eq("id", user.id)
    .single();

  return profile;
}

/**
 * Gate a Server Component or Server Action to specific roles.
 * Redirects to /login if the user is not signed in or does not hold one of
 * the allowed roles. Returns the profile when the user is authorised.
 *
 * Usage (Server Component):
 *   const profile = await requireRole("ADMIN");
 *
 * Usage (Server Action — prefer getCurrentUser() + manual check so you can
 * return {ok:false} instead of redirecting):
 *   await requireRole("ADMIN");
 */
export async function requireRole(...roles: AppRole[]) {
  const profile = await getCurrentUser();
  if (!profile) redirect("/login");
  if (!roles.includes(profile.role as AppRole)) redirect("/login");
  return profile;
}
