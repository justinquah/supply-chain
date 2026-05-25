import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import { getStock } from "@/lib/lazada";

// Sync stock levels FROM Lazada → update our currentStock
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  try {
    // Get all products with seller SKUs
    const products = await prisma.product.findMany({
      where: { isActive: true, sellerSku: { not: null } },
      select: { id: true, sku: true, sellerSku: true, name: true, currentStock: true },
    });

    if (products.length === 0) {
      return NextResponse.json({
        error: "No products with seller SKUs found. Add seller SKUs to your products first.",
      }, { status: 400 });
    }

    // Query Lazada in batches of 50 SKUs
    let matched = 0;
    let unmatched = 0;
    const updates: { sku: string; name: string; oldStock: number; newStock: number }[] = [];

    for (let i = 0; i < products.length; i += 50) {
      const batch = products.slice(i, i + 50);
      const skus = batch.map((p) => p.sellerSku!).filter(Boolean);

      try {
        const result = await getStock(skus);
        const stockData = result?.data || [];

        for (const stock of stockData) {
          // Lazada returns: { seller_sku, sellable_quantity, warehouse_code }
          const product = batch.find((p) => p.sellerSku === stock.seller_sku);
          if (!product) {
            unmatched++;
            continue;
          }

          const newStock = parseInt(stock.sellable_quantity || "0");

          // Update product stock
          await prisma.product.update({
            where: { id: product.id },
            data: { currentStock: newStock },
          });

          matched++;
          updates.push({
            sku: product.sku,
            name: product.name,
            oldStock: product.currentStock,
            newStock,
          });
        }
      } catch (batchError: any) {
        console.error(`Batch error for SKUs ${skus.join(",")}:`, batchError.message);
      }
    }

    return NextResponse.json({
      success: true,
      totalProducts: products.length,
      matched,
      unmatched,
      updates: updates.slice(0, 20), // Return first 20 for display
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to sync inventory" },
      { status: 500 }
    );
  }
}
