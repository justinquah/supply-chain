import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import { getAuthorizationUrl, getShopInfo } from "@/lib/shopee";
import { getIntegrationToken } from "@/lib/integration-tokens";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const { searchParams } = req.nextUrl;
  const action = searchParams.get("action");

  if (action === "authorize") {
    const redirectUri = `${process.env.NEXTAUTH_URL}/api/integrations/shopee/callback`;
    const authUrl = getAuthorizationUrl(redirectUri);
    return NextResponse.json({ authUrl });
  }

  if (action === "status") {
    try {
      const hasPartnerId = !!process.env.SHOPEE_PARTNER_ID;
      const environment = process.env.SHOPEE_ENVIRONMENT || "sandbox";

      if (!hasPartnerId) {
        return NextResponse.json({
          connected: false,
          status: "NOT_CONFIGURED",
          message: "Shopee API credentials not configured",
        });
      }

      // Check DB first, then env vars
      const dbToken = await getIntegrationToken("SHOPEE");
      const accessToken = dbToken.accessToken || process.env.SHOPEE_ACCESS_TOKEN;
      const shopId = dbToken.shopId || process.env.SHOPEE_SHOP_ID;

      if (!accessToken || !shopId) {
        return NextResponse.json({
          connected: false,
          status: "NEEDS_AUTH",
          message: "App configured but seller authorization needed",
          partnerId: process.env.SHOPEE_PARTNER_ID,
          environment,
        });
      }

      const shop = await getShopInfo();
      return NextResponse.json({
        connected: true,
        status: "CONNECTED",
        environment,
        shop: shop || null,
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
