// Server-side Supabase client for Server Components, Route Handlers, and Server Actions.
// Cookies are async in Next.js 16+ — note the `await cookies()`.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
    }
  );
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
