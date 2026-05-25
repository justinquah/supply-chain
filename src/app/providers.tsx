"use client";

// Reserved for future client-side providers (toasts, theme, etc.).
// Supabase auth is handled server-side via cookies + proxy, no provider needed.
export function Providers({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
