import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import { getOrders } from "@/lib/tiktok-shop";
import { resolveMarketplaceSku } from "@/lib/sku-mapping";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const body = await req.json();
  const { startDate, endDate } = body;

  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: "startDate and endDate required (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  try {
    const startTs = Math.floor(new Date(startDate).getTime() / 1000);
    const endTs = Math.floor(new Date(endDate).getTime() / 1000);

    let allOrders: any[] = [];
    let pageToken: string | undefined;
    let page = 0;

    // Paginate through all orders
    do {
      const result = await getOrders({
        create_time_ge: startTs,
        create_time_lt: endTs,
        order_status: "COMPLETED",
        page_size: 50,
        page_token: pageToken,
      });

      if (result?.orders) {
        allOrders = allOrders.concat(result.orders);
      }

      pageToken = result?.next_page_token;
      page++;
    } while (pageToken && page < 100); // Safety limit

    // Aggregate orders by product SKU and month
    const monthlySalesMap: Record<
      string,
      { productId: string; year: number; month: number; units: number; revenue: number }
    > = {};

    let matched = 0;
    let unmatched = 0;
    const unmatchedSkus: Set<string> = new Set();

    for (const order of allOrders) {
      const orderDate = new Date((order.create_time || 0) * 1000);
      const year = orderDate.getFullYear();
      const month = orderDate.getMonth() + 1;

      for (const item of order.line_items || []) {
        const sku = item.seller_sku || item.sku_id;
        if (!sku) continue;

        const qty = item.quantity || 1;
        const price = parseFloat(item.sale_price || "0") * qty;

        // Use SKU mapping resolver (handles bundles like ABCX6, ABC+CDE)
        const decomposed = await resolveMarketplaceSku(sku, qty);

        if (decomposed.length === 0) {
          unmatched++;
          unmatchedSkus.add(sku);
          continue;
        }

        matched++;

        // Revenue split proportionally across components
        const totalUnits = decomposed.reduce((a, b) => a + b.units, 0);

        for (const component of decomposed) {
          const componentRevenue = totalUnits > 0 ? (price * component.units) / totalUnits : 0;
          const key = `${component.productId}-${year}-${month}`;
          if (!monthlySalesMap[key]) {
            monthlySalesMap[key] = {
              productId: component.productId,
              year,
              month,
              units: 0,
              revenue: 0,
            };
          }
          monthlySalesMap[key].units += component.units;
          monthlySalesMap[key].revenue += componentRevenue;
        }
      }
    }

    // Upsert monthly sales records for TIKTOK channel
    let synced = 0;
    for (const data of Object.values(monthlySalesMap)) {
      await prisma.monthlySales.upsert({
        where: {
          productId_year_month_channel: {
            productId: data.productId,
            year: data.year,
            month: data.month,
            channel: "TIKTOK",
          },
        },
        update: {
          unitsSold: data.units,
          revenue: Math.round(data.revenue * 100) / 100,
        },
        create: {
          productId: data.productId,
          year: data.year,
          month: data.month,
          channel: "TIKTOK",
          unitsSold: data.units,
          revenue: Math.round(data.revenue * 100) / 100,
          enteredBy: user.id,
        },
      });
      synced++;
    }

    return NextResponse.json({
      success: true,
      unmatchedSkus: Array.from(unmatchedSkus).slice(0, 50),
      totalOrders: allOrders.length,
      matchedItems: matched,
      unmatchedItems: unmatched,
      monthlySalesUpdated: synced,
      period: { startDate, endDate },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to sync orders" },
      { status: 500 }
    );
  }
}
