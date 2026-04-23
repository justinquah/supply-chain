import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized } from "@/lib/auth-guard";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const { searchParams } = req.nextUrl;
  const months = parseInt(searchParams.get("months") || "6");
  const channel = searchParams.get("channel"); // SHOPEE, LAZADA, TIKTOK or null for all

  const now = new Date();
  const dateConditions: any[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    dateConditions.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }

  const onlineChannels = channel ? [channel] : ["SHOPEE", "LAZADA", "TIKTOK"];

  const sales = await prisma.monthlySales.findMany({
    where: {
      OR: dateConditions,
      channel: { in: onlineChannels },
    },
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          sellerSku: true,
          name: true,
          category: { select: { name: true } },
        },
      },
    },
  });

  // Monthly trend by platform
  const monthlyByPlatform: Record<string, Record<string, { units: number; revenue: number }>> = {};

  for (const s of sales) {
    const key = `${s.year}-${String(s.month).padStart(2, "0")}`;
    if (!monthlyByPlatform[key]) monthlyByPlatform[key] = {};
    if (!monthlyByPlatform[key][s.channel]) {
      monthlyByPlatform[key][s.channel] = { units: 0, revenue: 0 };
    }
    monthlyByPlatform[key][s.channel].units += s.unitsSold;
    monthlyByPlatform[key][s.channel].revenue += s.revenue;
  }

  const monthlyTrend = Object.entries(monthlyByPlatform)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, channels]) => ({ month, ...channels }));

  // Platform totals
  const platformTotals: Record<string, { units: number; revenue: number; products: number }> = {};
  const productsByPlatform: Record<string, Set<string>> = {};

  for (const s of sales) {
    if (!platformTotals[s.channel]) {
      platformTotals[s.channel] = { units: 0, revenue: 0, products: 0 };
      productsByPlatform[s.channel] = new Set();
    }
    platformTotals[s.channel].units += s.unitsSold;
    platformTotals[s.channel].revenue += s.revenue;
    productsByPlatform[s.channel].add(s.productId);
  }

  for (const [ch, prods] of Object.entries(productsByPlatform)) {
    platformTotals[ch].products = prods.size;
  }

  // Top products per platform
  const productByPlatform: Record<string, Record<string, { name: string; sku: string; units: number; revenue: number }>> = {};

  for (const s of sales) {
    if (!productByPlatform[s.channel]) productByPlatform[s.channel] = {};
    if (!productByPlatform[s.channel][s.productId]) {
      productByPlatform[s.channel][s.productId] = {
        name: s.product.name,
        sku: s.product.sku,
        units: 0,
        revenue: 0,
      };
    }
    productByPlatform[s.channel][s.productId].units += s.unitsSold;
    productByPlatform[s.channel][s.productId].revenue += s.revenue;
  }

  const topByPlatform: Record<string, { name: string; sku: string; units: number; revenue: number }[]> = {};
  for (const [ch, prods] of Object.entries(productByPlatform)) {
    topByPlatform[ch] = Object.values(prods)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
  }

  return NextResponse.json({
    platformTotals,
    monthlyTrend,
    topByPlatform,
    totalUnits: sales.reduce((a, b) => a + b.unitsSold, 0),
    totalRevenue: sales.reduce((a, b) => a + b.revenue, 0),
  });
}
