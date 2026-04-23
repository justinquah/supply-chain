import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized } from "@/lib/auth-guard";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const { searchParams } = req.nextUrl;
  const months = parseInt(searchParams.get("months") || "6");
  const categoryId = searchParams.get("categoryId");

  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth() - months, 1);

  // Build date range conditions
  const dateConditions: any[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    dateConditions.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }

  const where: any = { OR: dateConditions };
  if (categoryId) {
    where.product = { categoryId };
  }

  const sales = await prisma.monthlySales.findMany({
    where,
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          sellerSku: true,
          name: true,
          categoryId: true,
          category: { select: { name: true } },
        },
      },
    },
  });

  // Aggregate by month
  const monthlyTotals: Record<string, {
    year: number;
    month: number;
    online: number;
    offline: number;
    total: number;
    onlineRevenue: number;
    offlineRevenue: number;
    totalRevenue: number;
    byChannel: Record<string, { units: number; revenue: number }>;
  }> = {};

  const onlineChannels = ["SHOPEE", "LAZADA", "TIKTOK"];

  for (const s of sales) {
    const key = `${s.year}-${String(s.month).padStart(2, "0")}`;
    if (!monthlyTotals[key]) {
      monthlyTotals[key] = {
        year: s.year,
        month: s.month,
        online: 0,
        offline: 0,
        total: 0,
        onlineRevenue: 0,
        offlineRevenue: 0,
        totalRevenue: 0,
        byChannel: {},
      };
    }

    const mt = monthlyTotals[key];
    const isOnline = onlineChannels.includes(s.channel);

    if (isOnline) {
      mt.online += s.unitsSold;
      mt.onlineRevenue += s.revenue;
    } else {
      mt.offline += s.unitsSold;
      mt.offlineRevenue += s.revenue;
    }
    mt.total += s.unitsSold;
    mt.totalRevenue += s.revenue;

    if (!mt.byChannel[s.channel]) {
      mt.byChannel[s.channel] = { units: 0, revenue: 0 };
    }
    mt.byChannel[s.channel].units += s.unitsSold;
    mt.byChannel[s.channel].revenue += s.revenue;
  }

  // Sort by date ascending
  const monthlyData = Object.entries(monthlyTotals)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);

  // Top products by total units
  const productTotals: Record<string, {
    productId: string;
    sku: string;
    sellerSku: string | null;
    name: string;
    category: string;
    totalUnits: number;
    totalRevenue: number;
    onlineUnits: number;
    offlineUnits: number;
    byChannel: Record<string, { units: number; revenue: number }>;
  }> = {};

  for (const s of sales) {
    const pid = s.productId;
    if (!productTotals[pid]) {
      productTotals[pid] = {
        productId: pid,
        sku: s.product.sku,
        sellerSku: s.product.sellerSku,
        name: s.product.name,
        category: s.product.category.name,
        totalUnits: 0,
        totalRevenue: 0,
        onlineUnits: 0,
        offlineUnits: 0,
        byChannel: {},
      };
    }

    const pt = productTotals[pid];
    pt.totalUnits += s.unitsSold;
    pt.totalRevenue += s.revenue;

    if (onlineChannels.includes(s.channel)) {
      pt.onlineUnits += s.unitsSold;
    } else {
      pt.offlineUnits += s.unitsSold;
    }

    if (!pt.byChannel[s.channel]) {
      pt.byChannel[s.channel] = { units: 0, revenue: 0 };
    }
    pt.byChannel[s.channel].units += s.unitsSold;
    pt.byChannel[s.channel].revenue += s.revenue;
  }

  const topProducts = Object.values(productTotals)
    .sort((a, b) => b.totalRevenue - a.totalRevenue);

  // Grand totals
  const grandTotal = {
    totalUnits: sales.reduce((a, b) => a + b.unitsSold, 0),
    totalRevenue: sales.reduce((a, b) => a + b.revenue, 0),
    onlineUnits: sales.filter((s) => onlineChannels.includes(s.channel)).reduce((a, b) => a + b.unitsSold, 0),
    offlineUnits: sales.filter((s) => !onlineChannels.includes(s.channel)).reduce((a, b) => a + b.unitsSold, 0),
    onlineRevenue: sales.filter((s) => onlineChannels.includes(s.channel)).reduce((a, b) => a + b.revenue, 0),
    offlineRevenue: sales.filter((s) => !onlineChannels.includes(s.channel)).reduce((a, b) => a + b.revenue, 0),
    months,
  };

  return NextResponse.json({
    grandTotal,
    monthlyData,
    topProducts,
  });
}
