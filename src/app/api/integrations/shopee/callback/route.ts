import { NextRequest, NextResponse } from "next/server";
import { getAccessToken } from "@/lib/shopee";
import { saveIntegrationToken } from "@/lib/integration-tokens";

// Shopee OAuth callback - receives code + shop_id
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const shopId = searchParams.get("shop_id");

  if (!code || !shopId) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=missing_code_or_shop_id", req.url)
    );
  }

  try {
    const tokenData = await getAccessToken(code, shopId);

    await saveIntegrationToken({
      provider: "SHOPEE",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      shopId,
      expiresAt: tokenData.expire_in
        ? new Date(Date.now() + tokenData.expire_in * 1000)
        : undefined,
    });

    return NextResponse.redirect(
      new URL("/settings/integrations?shopee=connected", req.url)
    );
  } catch (error: any) {
    console.error("Shopee OAuth error:", error);
    return NextResponse.redirect(
      new URL(
        `/settings/integrations?error=${encodeURIComponent(error.message)}`,
        req.url
      )
    );
  }
}
