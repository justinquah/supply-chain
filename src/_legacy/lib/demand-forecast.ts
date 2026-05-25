import { prisma } from "./prisma";

export type ChannelBreakdown = {
  channel: string;
  unitsSold: number;
  revenue: number;
};

export type ProductForecast = {
  productId: string;
  threeMonthAvg: number;
  monthsOfData: number;
  channelBreakdown: ChannelBreakdown[];
  onlineTotal: number;
  offlineTotal: number;
  totalUnits: number;
  // MTD
  mtdTotal: number;
  mtdOnline: number;
  mtdOffline: number;
  mtdChannels: ChannelBreakdown[];
  mtdDaysElapsed: number;
  dailyRunRate: number;
  projectedMonthTotal: number;
  // Inventory health
  currentStock: number;
  daysToOOS: number | null; // null = infinite (no sales)
  inTransitQty: number;
  daysToOOSWithTransit: number | null;
  // Transit detail by PO
  transitDetails: { poNumber: string; poId: string; quantity: number; eta: string | null }[];
  // Turnover
  targetTurnover: number;
  actualTurnover: number | null;
  idealStock: number;
  stockStatus: "CRITICAL" | "AT_RISK" | "HEALTHY" | "OVERSTOCKED";
  // Promo
  promoUplift: number;
  adjustedForecast: number;
};

const ONLINE_CHANNELS = ["SHOPEE", "LAZADA", "TIKTOK"];
const OFFLINE_CHANNELS = ["AUTOCOUNT"];

export async function getProductForecast(
  productId: string
): Promise<ProductForecast | null> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      category: true,
    },
  });

  if (!product) return null;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // Get last 3 months of sales data
  const threeMonthsData: { year: number; month: number }[] = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(currentYear, currentMonth - 1 - i, 1);
    threeMonthsData.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }

  const salesLast3 = await prisma.monthlySales.findMany({
    where: {
      productId,
      OR: threeMonthsData.map((d) => ({ year: d.year, month: d.month })),
    },
  });

  // Aggregate by month for 3-month avg
  const monthTotals = new Map<string, number>();
  const channelTotals = new Map<string, { units: number; revenue: number }>();

  for (const s of salesLast3) {
    const key = `${s.year}-${s.month}`;
    monthTotals.set(key, (monthTotals.get(key) || 0) + s.unitsSold);

    const ch = channelTotals.get(s.channel) || { units: 0, revenue: 0 };
    ch.units += s.unitsSold;
    ch.revenue += s.revenue;
    channelTotals.set(s.channel, ch);
  }

  const monthsOfData = monthTotals.size;
  const totalUnitsLast3 = Array.from(monthTotals.values()).reduce(
    (a, b) => a + b,
    0
  );
  const threeMonthAvg =
    monthsOfData > 0 ? Math.round(totalUnitsLast3 / monthsOfData) : 0;

  const channelBreakdown: ChannelBreakdown[] = Array.from(
    channelTotals.entries()
  ).map(([channel, data]) => ({
    channel,
    unitsSold: Math.round(data.units / (monthsOfData || 1)),
    revenue: Math.round((data.revenue / (monthsOfData || 1)) * 100) / 100,
  }));

  const onlineTotal = channelBreakdown
    .filter((c) => ONLINE_CHANNELS.includes(c.channel))
    .reduce((a, b) => a + b.unitsSold, 0);
  const offlineTotal = channelBreakdown
    .filter((c) => OFFLINE_CHANNELS.includes(c.channel))
    .reduce((a, b) => a + b.unitsSold, 0);

  // MTD - current month sales
  const mtdSales = await prisma.monthlySales.findMany({
    where: { productId, year: currentYear, month: currentMonth },
  });

  const mtdTotal = mtdSales.reduce((a, b) => a + b.unitsSold, 0);
  const mtdOnline = mtdSales
    .filter((s) => ONLINE_CHANNELS.includes(s.channel))
    .reduce((a, b) => a + b.unitsSold, 0);
  const mtdOffline = mtdSales
    .filter((s) => OFFLINE_CHANNELS.includes(s.channel))
    .reduce((a, b) => a + b.unitsSold, 0);
  const mtdChannels: ChannelBreakdown[] = mtdSales.map((s) => ({
    channel: s.channel,
    unitsSold: s.unitsSold,
    revenue: s.revenue,
  }));

  const mtdDaysElapsed = now.getDate();
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
  const dailyRunRate = mtdDaysElapsed > 0 ? mtdTotal / mtdDaysElapsed : threeMonthAvg / 30;
  const projectedMonthTotal = Math.round(dailyRunRate * daysInMonth);

  // In-transit quantity from active POs with detail
  const inTransitPOs = await prisma.pOLineItem.findMany({
    where: {
      productId,
      purchaseOrder: {
        status: { in: ["CONFIRMED", "IN_TRANSIT", "CUSTOMS", "PENDING_SUPPLIER"] },
      },
    },
    select: {
      quantity: true,
      purchaseOrder: {
        select: {
          id: true,
          poNumber: true,
          shipment: { select: { eta: true } },
        },
      },
    },
  });
  const inTransitQty = inTransitPOs.reduce((a, b) => a + b.quantity, 0);
  const transitDetails = inTransitPOs.map((po) => ({
    poNumber: po.purchaseOrder.poNumber,
    poId: po.purchaseOrder.id,
    quantity: po.quantity,
    eta: po.purchaseOrder.shipment?.eta?.toISOString() || null,
  }));

  // Days to OOS
  const daysToOOS =
    dailyRunRate > 0 ? Math.round(product.currentStock / dailyRunRate) : null;
  const daysToOOSWithTransit =
    dailyRunRate > 0
      ? Math.round((product.currentStock + inTransitQty) / dailyRunRate)
      : null;

  // Turnover
  const targetTurnover =
    product.targetTurnover ?? product.category.defaultTargetTurnover;
  const annualSalesEst = threeMonthAvg * 12;
  const actualTurnover =
    product.currentStock > 0
      ? Math.round((annualSalesEst / product.currentStock) * 10) / 10
      : null;
  const idealStock =
    targetTurnover > 0 ? Math.round(annualSalesEst / targetTurnover) : 0;

  // Stock status
  let stockStatus: ProductForecast["stockStatus"] = "HEALTHY";
  if (daysToOOS !== null && daysToOOS <= 7) {
    stockStatus = "CRITICAL";
  } else if (daysToOOS !== null && daysToOOS <= 21) {
    stockStatus = "AT_RISK";
  } else if (
    product.currentStock > idealStock * 1.5 &&
    idealStock > 0
  ) {
    stockStatus = "OVERSTOCKED";
  }

  // Promo uplift for next month
  const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
  const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;

  const promoProducts = await prisma.promoProduct.findMany({
    where: {
      productId,
      promo: { year: nextYear, month: nextMonth, isActive: true },
    },
    include: { promo: true },
  });

  let promoUplift = 0;
  for (const pp of promoProducts) {
    if (pp.promo.upliftType === "UNITS") {
      promoUplift += pp.upliftValue;
    } else {
      // PERCENT
      promoUplift += Math.round(threeMonthAvg * (pp.upliftValue / 100));
    }
  }

  const adjustedForecast = threeMonthAvg + promoUplift;

  return {
    productId,
    threeMonthAvg,
    monthsOfData,
    channelBreakdown,
    onlineTotal,
    offlineTotal,
    totalUnits: onlineTotal + offlineTotal,
    mtdTotal,
    mtdOnline,
    mtdOffline,
    mtdChannels,
    mtdDaysElapsed,
    dailyRunRate: Math.round(dailyRunRate * 10) / 10,
    projectedMonthTotal,
    currentStock: product.currentStock,
    daysToOOS,
    inTransitQty,
    transitDetails,
    daysToOOSWithTransit,
    targetTurnover,
    actualTurnover,
    idealStock,
    stockStatus,
    promoUplift,
    adjustedForecast,
  };
}
