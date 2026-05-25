import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import { getOrderList, getOrderDetail } from "@/lib/shopee";
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
    const timeFrom = Math.floor(new Date(startDate).getTime() / 1000);
    const timeTo = Math.floor(new Date(endDate).getTime() / 1000);

    // Shopee limits to 15-day ranges per query - we paginate if needed
    let allOrderSns: string[] = [];
    let cursor = "";
    let segmentFrom = timeFrom;

    // Chunk into 15-day segments
    const SEGMENT_SECONDS = 14 * 24 * 60 * 60;

    while (segmentFrom < timeTo) {
      const segmentTo = Math.min(segmentFrom + SEGMENT_SECONDS, timeTo);
      cursor = "";

      do {
        const result = await getOrderList({
          time_range_field: "create_time",
          time_from: segmentFrom,
          time_to: segmentTo,
          page_size: 50,
          cursor: cursor || undefined,
          order_status: "COMPLETED",
        });

        const resp = result?.response;
        if (resp?.order_list) {
          allOrderSns = allOrderSns.concat(resp.order_list.map((o: any) => o.order_sn));
        }

        cursor = resp?.next_cursor || "";
        if (!resp?.more) break;
      } while (cursor);

      segmentFrom = segmentTo;
    }

    // Get order details in batches of 50
    const monthlySalesMap: Record<
      string,
      { productId: string; year: number; month: number; units: number; revenue: number }
    > = {};

    let matched = 0;
    let unmatched = 0;
    const unmatchedSkus: Set<string> = new Set();

    for (let i = 0; i < allOrderSns.length; i += 50) {
      const batch = allOrderSns.slice(i, i + 50);
      const detailsResult = await getOrderDetail(batch, [
        "item_list",
        "total_amount",
        "create_time",
      ]);

      const orders = detailsResult?.response?.order_list || [];

      for (const order of orders) {
        const orderDate = new Date((order.create_time || 0) * 1000);
        const year = orderDate.getFullYear();
        const month = orderDate.getMonth() + 1;

        for (const item of order.item_list || []) {
          const sku = item.item_sku || item.model_sku || item.seller_sku;
          if (!sku) continue;

          const qty = item.model_quantity_purchased || item.quantity_purchased || 1;
          const itemRevenue =
            parseFloat(item.model_discounted_price || item.model_original_price || "0") * qty;

          const decomposed = await resolveMarketplaceSku(sku, qty);

          if (decomposed.length === 0) {
            unmatched++;
            unmatchedSkus.add(sku);
            continue;
          }

          matched++;
          const totalUnits = decomposed.reduce((a, b) => a + b.units, 0);

          for (const component of decomposed) {
            const componentRevenue =
              totalUnits > 0 ? (itemRevenue * component.units) / totalUnits : 0;
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
    }

    let synced = 0;
    for (const data of Object.values(monthlySalesMap)) {
      await prisma.monthlySales.upsert({
        where: {
          productId_year_month_channel: {
            productId: data.productId,
            year: data.year,
            month: data.month,
            channel: "SHOPEE",
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
          channel: "SHOPEE",
          unitsSold: data.units,
          revenue: Math.round(data.revenue * 100) / 100,
          enteredBy: user.id,
        },
      });
      synced++;
    }

    return NextResponse.json({
      success: true,
      totalOrders: allOrderSns.length,
      matchedItems: matched,
      unmatchedItems: unmatched,
      unmatchedSkus: Array.from(unmatchedSkus).slice(0, 50),
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
