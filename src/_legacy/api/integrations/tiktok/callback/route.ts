import { NextRequest, NextResponse } from "next/server";
import { getAccessToken } from "@/lib/tiktok-shop";
import { saveIntegrationToken } from "@/lib/integration-tokens";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=no_code", req.url)
    );
  }

  try {
    const tokenData = await getAccessToken(code);

    await saveIntegrationToken({
      provider: "TIKTOK",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: tokenData.access_token_expire_in
        ? new Date(Date.now() + tokenData.access_token_expire_in * 1000)
        : undefined,
    });

    return NextResponse.redirect(
      new URL("/settings/integrations?tiktok=connected", req.url)
    );
  } catch (error: any) {
    console.error("TikTok OAuth error:", error);
    return NextResponse.redirect(
      new URL(`/settings/integrations?error=${encodeURIComponent(error.message)}`, req.url)
    );
  }
}
