import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import * as XLSX from "xlsx";

/**
 * Import inventory levels from Qianyi ERP export file
 *
 * The file has:
 * - Row 1: Section headers (Product information, Inventory information, ...)
 * - Row 2: Actual column headers
 * - Row 3+: Data
 *
 * Key columns:
 * - "Commodity code" → maps to Product.sku (primary identifier)
 * - "Available quantity" → updates Product.currentStock
 * - "warehouse" → which warehouse (for reference)
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "File required" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    // Read with header on row 2 (since Qianyi has section headers on row 1)
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, {
      range: 1, // start from row 2 (0-indexed 1)
      defval: null,
    });

    if (rows.length === 0) {
      return NextResponse.json({ error: "File is empty" }, { status: 400 });
    }

    // Try both the Qianyi format and a simpler format with flexible column naming
    function findKey(row: any, candidates: string[]): string | null {
      const keys = Object.keys(row);
      for (const candidate of candidates) {
        const match = keys.find(
          (k) =>
            k.toLowerCase().replace(/[\s_-]+/g, "") ===
            candidate.toLowerCase().replace(/[\s_-]+/g, "")
        );
        if (match) return match;
      }
      return null;
    }

    const sample = rows[0];
    const skuKey = findKey(sample, [
      "commoditycode",
      "commodity code",
      "sku",
      "productcode",
      "itemcode",
    ]);
    const availableKey = findKey(sample, [
      "availablequantity",
      "available quantity",
      "available",
      "stock",
      "currentstock",
    ]);
    const inventoryKey = findKey(sample, ["inventorylevel", "inventory level"]);
    const warehouseKey = findKey(sample, ["warehouse"]);

    if (!skuKey) {
      return NextResponse.json(
        {
          error: "Could not find Commodity code / SKU column",
          availableColumns: Object.keys(sample).slice(0, 30),
        },
        { status: 400 }
      );
    }

    if (!availableKey && !inventoryKey) {
      return NextResponse.json(
        {
          error: "Could not find Available quantity / Inventory level column",
          availableColumns: Object.keys(sample).slice(0, 30),
        },
        { status: 400 }
      );
    }

    // Aggregate stock by SKU (if multiple warehouses, sum them)
    const stockBySku: Record<string, { sku: string; qty: number; warehouses: string[] }> = {};

    for (const row of rows) {
      const sku = String(row[skuKey] || "").trim();
      if (!sku) continue;

      const qty = parseInt(String(row[availableKey || inventoryKey!] || 0));
      const warehouse = warehouseKey ? String(row[warehouseKey] || "").trim() : "";

      if (!stockBySku[sku]) {
        stockBySku[sku] = { sku, qty: 0, warehouses: [] };
      }
      stockBySku[sku].qty += qty;
      if (warehouse && !stockBySku[sku].warehouses.includes(warehouse)) {
        stockBySku[sku].warehouses.push(warehouse);
      }
    }

    // Update products
    const updates: {
      sku: string;
      name: string;
      oldStock: number;
      newStock: number;
      warehouses: string[];
    }[] = [];
    const notFound: { sku: string; qty: number }[] = [];

    for (const data of Object.values(stockBySku)) {
      // Match by sku, sellerSku, or barcode
      const product = await prisma.product.findFirst({
        where: {
          OR: [
            { sku: data.sku },
            { sellerSku: data.sku },
            { barcode: data.sku },
          ],
        },
        select: { id: true, sku: true, name: true, currentStock: true },
      });

      if (!product) {
        notFound.push({ sku: data.sku, qty: data.qty });
        continue;
      }

      if (product.currentStock !== data.qty) {
        await prisma.product.update({
          where: { id: product.id },
          data: { currentStock: data.qty },
        });
      }

      updates.push({
        sku: product.sku,
        name: product.name,
        oldStock: product.currentStock,
        newStock: data.qty,
        warehouses: data.warehouses,
      });
    }

    return NextResponse.json({
      success: true,
      totalRows: rows.length,
      uniqueSkus: Object.keys(stockBySku).length,
      productsUpdated: updates.length,
      productsNotFound: notFound.length,
      notFoundSkus: notFound.slice(0, 30),
      updates: updates.slice(0, 20),
      columnsDetected: {
        sku: skuKey,
        quantity: availableKey || inventoryKey,
        warehouse: warehouseKey || "not detected",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Import failed" },
      { status: 500 }
    );
  }
}
