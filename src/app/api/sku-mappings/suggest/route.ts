import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import { tryAutoParse, suggestMappings } from "@/lib/sku-mapping";

// Given a SKU, try to auto-parse it and suggest a mapping
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const body = await req.json();
  const { skus, singleSku } = body;

  if (singleSku) {
    const suggestion = await tryAutoParse(singleSku);
    return NextResponse.json({ marketplaceSku: singleSku, suggestion });
  }

  if (skus && Array.isArray(skus)) {
    const results = await suggestMappings(skus);
    return NextResponse.json(results);
  }

  return NextResponse.json(
    { error: "Provide 'skus' array or 'singleSku' string" },
    { status: 400 }
  );
}
