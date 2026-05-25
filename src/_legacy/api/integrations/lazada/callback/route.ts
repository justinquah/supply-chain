import { NextRequest, NextResponse } from "next/server";
import { getAccessToken } from "@/lib/lazada";
import { saveIntegrationToken } from "@/lib/integration-tokens";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/settings/integrations?error=no_code", req.url));
  }

  try {
    const tokenData = await getAccessToken(code);

    await saveIntegrationToken({
      provider: "LAZADA",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      shopId: tokenData.account_id,
      shopName: tokenData.account,
      extra: { country: tokenData.country },
      expiresAt: tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000)
        : undefined,
    });

    return NextResponse.redirect(
      new URL("/settings/integrations?lazada=connected", req.url)
    );
  } catch (error: any) {
    console.error("Lazada OAuth error:", error);
    return NextResponse.redirect(
      new URL(`/settings/integrations?error=${encodeURIComponent(error.message)}`, req.url)
    );
  }
}
