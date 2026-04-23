import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import { getItemList, getItemBaseInfo } from "@/lib/shopee";

// Sync stock levels FROM Shopee → update our currentStock
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  try {
    // Fetch all Shopee items (paginated)
    let allItemIds: number[] = [];
    let offset = 0;
    const pageSize = 50;

    while (true) {
      const result = await getItemList({
        offset,
        page_size: pageSize,
        item_status: "NORMAL",
      });

      const items = result?.response?.item || [];
      allItemIds = allItemIds.concat(items.map((i: any) => i.item_id));

      if (items.length < pageSize || !result?.response?.has_next_page) break;
      offset += pageSize;
      if (offset > 5000) break; // safety
    }

    // Fetch detail for each batch of items (to get SKU + stock)
    let matched = 0;
    let unmatched = 0;
    const updates: { sku: string; name: string; oldStock: number; newStock: number }[] = [];

    for (let i = 0; i < allItemIds.length; i += 50) {
      const batchIds = allItemIds.slice(i, i + 50);
      const result = await getItemBaseInfo(batchIds);

      const items = result?.response?.item_list || [];

      for (const shopeeItem of items) {
        const itemSku = shopeeItem.item_sku;

        // An item may have multiple models (variants). Process each
        const models = shopeeItem.model_list || [];

        if (models.length === 0 && itemSku) {
          // Single-SKU item
          const stockCount = shopeeItem.stock_info?.[0]?.current_stock ||
                             shopeeItem.stock_info_v2?.summary_info?.total_available_stock || 0;

          const product = await prisma.product.findFirst({
            where: { OR: [{ sku: itemSku }, { sellerSku: itemSku }, { barcode: itemSku }] },
          });

          if (product) {
            const oldStock = product.currentStock;
            await prisma.product.update({
              where: { id: product.id },
              data: { currentStock: stockCount },
            });
            matched++;
            updates.push({ sku: product.sku, name: product.name, oldStock, newStock: stockCount });
          } else {
            unmatched++;
          }
        } else {
          // Multi-model item: process each model
          for (const model of models) {
            const modelSku = model.model_sku;
            if (!modelSku) continue;

            const stockCount = model.stock_info?.[0]?.current_stock ||
                                model.stock_info_v2?.summary_info?.total_available_stock || 0;

            const product = await prisma.product.findFirst({
              where: { OR: [{ sku: modelSku }, { sellerSku: modelSku }, { barcode: modelSku }] },
            });

            if (product) {
              const oldStock = product.currentStock;
              await prisma.product.update({
                where: { id: product.id },
                data: { currentStock: stockCount },
              });
              matched++;
              updates.push({ sku: product.sku, name: product.name, oldStock, newStock: stockCount });
            } else {
              unmatched++;
            }
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      totalShopeeItems: allItemIds.length,
      matched,
      unmatched,
      updates: updates.slice(0, 20),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to sync inventory" },
      { status: 500 }
    );
  }
}
