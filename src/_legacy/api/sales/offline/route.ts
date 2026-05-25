import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized } from "@/lib/auth-guard";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const { searchParams } = req.nextUrl;
  const months = parseInt(searchParams.get("months") || "6");

  const now = new Date();
  const dateConditions: any[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    dateConditions.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }

  const sales = await prisma.monthlySales.findMany({
    where: {
      OR: dateConditions,
      channel: "AUTOCOUNT",
    },
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          sellerSku: true,
          name: true,
          category: { select: { name: true } },
          unitCost: true,
          sellingPrice: true,
        },
      },
    },
  });

  // Monthly trend
  const monthlyTrend: Record<string, { year: number; month: number; units: number; revenue: number }> = {};

  for (const s of sales) {
    const key = `${s.year}-${String(s.month).padStart(2, "0")}`;
    if (!monthlyTrend[key]) {
      monthlyTrend[key] = { year: s.year, month: s.month, units: 0, revenue: 0 };
    }
    monthlyTrend[key].units += s.unitsSold;
    monthlyTrend[key].revenue += s.revenue;
  }

  const trend = Object.entries(monthlyTrend)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);

  // By category
  const categoryTotals: Record<string, { category: string; units: number; revenue: number }> = {};

  for (const s of sales) {
    const cat = s.product.category.name;
    if (!categoryTotals[cat]) {
      categoryTotals[cat] = { category: cat, units: 0, revenue: 0 };
    }
    categoryTotals[cat].units += s.unitsSold;
    categoryTotals[cat].revenue += s.revenue;
  }

  // Top products
  const productTotals: Record<string, {
    productId: string;
    sku: string;
    sellerSku: string | null;
    name: string;
    category: string;
    units: number;
    revenue: number;
    margin: number;
  }> = {};

  for (const s of sales) {
    if (!productTotals[s.productId]) {
      const cost = s.product.unitCost;
      const price = s.product.sellingPrice || cost * 1.5;
      productTotals[s.productId] = {
        productId: s.productId,
        sku: s.product.sku,
        sellerSku: s.product.sellerSku,
        name: s.product.name,
        category: s.product.category.name,
        units: 0,
        revenue: 0,
        margin: price > 0 ? Math.round(((price - cost) / price) * 100) : 0,
      };
    }
    productTotals[s.productId].units += s.unitsSold;
    productTotals[s.productId].revenue += s.revenue;
  }

  const topProducts = Object.values(productTotals)
    .sort((a, b) => b.revenue - a.revenue);

  return NextResponse.json({
    monthlyTrend: trend,
    categoryBreakdown: Object.values(categoryTotals),
    topProducts,
    totalUnits: sales.reduce((a, b) => a + b.unitsSold, 0),
    totalRevenue: sales.reduce((a, b) => a + b.revenue, 0),
  });
}
