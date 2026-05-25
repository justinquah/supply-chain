import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server";
import { exchangeCodeForToken } from "@/lib/shopee";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCM", "ADMIN"].includes(user.role)) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const code = req.nextUrl.searchParams.get("code");
  const shopId = req.nextUrl.searchParams.get("shop_id");
  if (!code || !shopId) {
    return NextResponse.redirect(new URL("/settings?shopee_error=missing_code", req.url));
  }

  try {
    await exchangeCodeForToken(code, shopId);
    return NextResponse.redirect(new URL("/settings?shopee=connected", req.url));
  } catch (e: any) {
    const msg = encodeURIComponent(e?.message || "exchange_failed");
    return NextResponse.redirect(new URL(`/settings?shopee_error=${msg}`, req.url));
  }
}
