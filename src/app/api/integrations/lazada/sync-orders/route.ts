import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import { getOrders, getMultipleOrderItems } from "@/lib/lazada";
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
    const createdAfter = new Date(startDate).toISOString();
    const createdBefore = new Date(endDate).toISOString();

    let allOrders: any[] = [];
    let offset = 0;
    const limit = 50;

    // Paginate
    while (true) {
      const result = await getOrders({
        created_after: createdAfter,
        created_before: createdBefore,
        status: "delivered",
        limit,
        offset,
      });

      const orders = result?.data?.orders || [];
      allOrders = allOrders.concat(orders);

      if (orders.length < limit) break;
      offset += limit;
      if (offset > 1000) break; // Safety limit
    }

    // Fetch line items in batches of 50
    const monthlySalesMap: Record<
      string,
      { productId: string; year: number; month: number; units: number; revenue: number }
    > = {};

    let matched = 0;
    let unmatched = 0;

    for (let i = 0; i < allOrders.length; i += 50) {
      const batch = allOrders.slice(i, i + 50);
      const orderIds = batch.map((o: any) => String(o.order_id));

      const itemsResult = await getMultipleOrderItems(orderIds);
      const orderItems = itemsResult?.data || [];

      for (const orderItem of orderItems) {
        const order = allOrders.find((o: any) => o.order_id === orderItem.order_id);
        if (!order) continue;

        const orderDate = new Date(order.created_at);
        const year = orderDate.getFullYear();
        const month = orderDate.getMonth() + 1;

        for (const item of orderItem.order_items || []) {
          const sku = item.sku || item.seller_sku || item.shop_sku;
          if (!sku) continue;

          const qty = item.quantity || 1;
          const itemRevenue = parseFloat(item.item_price || item.paid_price || "0");

          // Use SKU mapping resolver
          const decomposed = await resolveMarketplaceSku(sku, qty);

          if (decomposed.length === 0) {
            unmatched++;
            continue;
          }

          matched++;
          const totalUnits = decomposed.reduce((a, b) => a + b.units, 0);

          for (const component of decomposed) {
            const componentRevenue = totalUnits > 0 ? (itemRevenue * component.units) / totalUnits : 0;
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

    // Upsert monthly sales
    let synced = 0;
    for (const data of Object.values(monthlySalesMap)) {
      await prisma.monthlySales.upsert({
        where: {
          productId_year_month_channel: {
            productId: data.productId,
            year: data.year,
            month: data.month,
            channel: "LAZADA",
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
          channel: "LAZADA",
          unitsSold: data.units,
          revenue: Math.round(data.revenue * 100) / 100,
          enteredBy: user.id,
        },
      });
      synced++;
    }

    return NextResponse.json({
      success: true,
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
