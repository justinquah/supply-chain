import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server";
import { getAuthorizationUrl } from "@/lib/shopee";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCM", "ADMIN"].includes(user.role)) {
    return NextResponse.redirect(new URL("/settings?error=forbidden", req.url));
  }
  if (!process.env.SHOPEE_PARTNER_ID || !process.env.SHOPEE_PARTNER_KEY) {
    return NextResponse.redirect(new URL("/settings?error=not_configured", req.url));
  }
  const redirectUri = `${req.nextUrl.origin}/api/shopee/callback`;
  return NextResponse.redirect(getAuthorizationUrl(redirectUri));
}
