import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import { getAuthorizationUrl, getSellerInfo } from "@/lib/lazada";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const { searchParams } = req.nextUrl;
  const action = searchParams.get("action");

  if (action === "authorize") {
    const redirectUri = `${process.env.NEXTAUTH_URL}/api/integrations/lazada/callback`;
    const authUrl = getAuthorizationUrl(redirectUri);
    return NextResponse.json({ authUrl });
  }

  if (action === "status") {
    try {
      const hasToken = !!process.env.LAZADA_ACCESS_TOKEN;
      const hasKey = !!process.env.LAZADA_APP_KEY;

      if (!hasKey) {
        return NextResponse.json({
          connected: false,
          status: "NOT_CONFIGURED",
          message: "Lazada API credentials not configured. Add LAZADA_APP_KEY and LAZADA_APP_SECRET to .env",
        });
      }

      if (!hasToken) {
        return NextResponse.json({
          connected: false,
          status: "NEEDS_AUTH",
          message: "App configured but seller authorization needed",
          appKey: process.env.LAZADA_APP_KEY,
          country: process.env.LAZADA_COUNTRY || "MY",
        });
      }

      // Try seller info to verify connection
      const seller = await getSellerInfo();
      return NextResponse.json({
        connected: true,
        status: "CONNECTED",
        seller: seller?.data || seller,
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
