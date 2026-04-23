import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import { getAuthorizationUrl, getAccessToken, getAuthorizedShops } from "@/lib/tiktok-shop";

// GET - Generate authorization URL or check connection status
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const { searchParams } = req.nextUrl;
  const action = searchParams.get("action");

  if (action === "authorize") {
    const redirectUri = `${process.env.NEXTAUTH_URL}/api/integrations/tiktok/callback`;
    const authUrl = getAuthorizationUrl(redirectUri);
    return NextResponse.json({ authUrl });
  }

  if (action === "status") {
    try {
      const hasToken = !!process.env.TIKTOK_SHOP_ACCESS_TOKEN;
      const hasKey = !!process.env.TIKTOK_SHOP_APP_KEY;

      if (!hasKey) {
        return NextResponse.json({
          connected: false,
          status: "NOT_CONFIGURED",
          message: "TikTok Shop API credentials not configured",
        });
      }

      if (!hasToken) {
        return NextResponse.json({
          connected: false,
          status: "NEEDS_AUTH",
          message: "App configured but seller authorization needed",
          appKey: process.env.TIKTOK_SHOP_APP_KEY,
        });
      }

      // Try to get shops to verify connection
      const shops = await getAuthorizedShops();
      return NextResponse.json({
        connected: true,
        status: "CONNECTED",
        shops: shops?.shops || [],
      });
    } catch (error: any) {
      return NextResponse.json({
        connected: false,
        status: "ERROR",
        message: error.message,
      });
    }
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
