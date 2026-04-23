import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized } from "@/lib/auth-guard";
import { getProductForecast } from "@/lib/demand-forecast";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const { searchParams } = req.nextUrl;
  const productId = searchParams.get("productId");
  const categoryId = searchParams.get("categoryId");
  const supplierId = searchParams.get("supplierId");
  const riskOnly = searchParams.get("riskOnly") === "true";

  // If single product requested
  if (productId) {
    const forecast = await getProductForecast(productId);
    if (!forecast) {
      return NextResponse.json(
        { error: "Product not found" },
        { status: 404 }
      );
    }
    return NextResponse.json(forecast);
  }

  // Get all products (with filters)
  const where: any = { isActive: true };
  if (categoryId) where.categoryId = categoryId;
  if (user.role === "SUPPLIER") {
    where.supplierId = user.id;
  } else if (supplierId) {
    where.supplierId = supplierId;
  }

  const products = await prisma.product.findMany({
    where,
    select: { id: true, sku: true, sellerSku: true, name: true, categoryId: true },
    orderBy: { name: "asc" },
  });

  const forecasts = [];
  for (const product of products) {
    const forecast = await getProductForecast(product.id);
    if (forecast) {
      if (riskOnly && forecast.stockStatus === "HEALTHY") continue;
      forecasts.push({
        ...forecast,
        sku: product.sku,
        sellerSku: product.sellerSku,
        name: product.name,
      });
    }
  }

  // Sort: CRITICAL first, then AT_RISK, then OVERSTOCKED, then HEALTHY
  const statusOrder = { CRITICAL: 0, AT_RISK: 1, OVERSTOCKED: 2, HEALTHY: 3 };
  forecasts.sort(
    (a, b) =>
      (statusOrder[a.stockStatus] ?? 99) - (statusOrder[b.stockStatus] ?? 99)
  );

  return NextResponse.json(forecasts);
}
