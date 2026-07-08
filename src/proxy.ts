// Next.js 16 proxy.ts (formerly middleware.ts).
// Refreshes the Supabase auth cookie and gates access.
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Run on everything except Next.js internals and static files (images + the
  // downloadable spreadsheet templates in /public, which must not be auth-gated).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|xlsx|xls|csv)$).*)",
  ],
};
