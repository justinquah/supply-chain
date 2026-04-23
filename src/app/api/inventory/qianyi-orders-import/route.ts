import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import * as XLSX from "xlsx";

/**
 * Import Qianyi "All Orders" (所有订单) export for online sales aggregation.
 *
 * Expected columns (with leading spaces in Qianyi export):
 * - Order Status (shipped/Close)
 * - Online Status (COMPLETED/DELIVERED/CANCELLED/...)
 * - Order Time (YYYY-MM-DD HH:MM:SS UTC+8)
 * - Platform (SHOPEE/TIKTOK/LAZADA/SHOPIFY)
 * - System Product Code (=our Product.sku)
 * - Online Product SKU ID (marketplace-specific SKU)
 * - Quantity
 * - Amount After Discount for Product Details
 *
 * Behaviour:
 * - Filters out CANCELLED/CANCELED/TO_RETURN orders
 * - Aggregates by product + year + month + platform
 * - Writes to MonthlySales with channel = Platform
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
    const rawRows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: null });

    if (rawRows.length === 0) {
      return NextResponse.json({ error: "File is empty" }, { status: 400 });
    }

    // Normalize column names (trim leading/trailing spaces)
    const rows = rawRows.map((r) => {
      const out: Record<string, any> = {};
      for (const k of Object.keys(r)) out[k.trim()] = r[k];
      return out;
    });

    const CANCELLED_STATUSES = new Set([
      "CANCELLED",
      "CANCELED",
      "TO_RETURN",
      "RETURNED",
      "REFUNDED",
    ]);

    const PLATFORM_TO_CHANNEL: Record<string, string> = {
      SHOPEE: "SHOPEE",
      TIKTOK: "TIKTOK",
      LAZADA: "LAZADA",
      SHOPIFY: "SHOPIFY",
    };

    let totalRows = rows.length;
    let cancelled = 0;
    let missingSku = 0;
    let missingDate = 0;
    let unknownPlatform = 0;
    let unmatched = 0;
    let matched = 0;
    const unmatchedSkus: Set<string> = new Set();

    // Pre-load all products into memory for fast O(1) lookup
    const allProducts = await prisma.product.findMany({
      select: { id: true, sku: true, sellerSku: true, barcode: true },
    });
    const productBySku = new Map<string, string>();
    const productBySellerSku = new Map<string, string>();
    const productByBarcode = new Map<string, string>();
    for (const p of allProducts) {
      if (p.sku) productBySku.set(p.sku, p.id);
      if (p.sellerSku) productBySellerSku.set(p.sellerSku, p.id);
      if (p.barcode) productByBarcode.set(p.barcode, p.id);
    }

    // Aggregate: productId-year-month-channel → { units, revenue }
    const aggregated: Record<
      string,
      {
        productId: string;
        year: number;
        month: number;
        channel: string;
        units: number;
        revenue: number;
      }
    > = {};

    for (const row of rows) {
      // Filter cancelled
      const onlineStatus = String(row["Online Status"] || "").toUpperCase();
      if (CANCELLED_STATUSES.has(onlineStatus)) {
        cancelled++;
        continue;
      }

      // Get SKU (prefer System Product Code, fallback to Online SKU ID)
      const systemSku = String(row["System Product Code"] || "").trim();
      const onlineSku = String(row["Online Product SKU ID"] || "").trim();
      const lookupSku = systemSku || onlineSku;
      if (!lookupSku) {
        missingSku++;
        continue;
      }

      // Parse date
      const orderTimeStr = String(row["Order Time"] || "");
      if (!orderTimeStr) {
        missingDate++;
        continue;
      }
      // "2026-03-29 00:11:26 UTC+8" → grab first 10 chars
      const dateMatch = orderTimeStr.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (!dateMatch) {
        missingDate++;
        continue;
      }
      const year = parseInt(dateMatch[1]);
      const month = parseInt(dateMatch[2]);

      // Platform → channel
      const platform = String(row["Platform"] || "").toUpperCase().trim();
      const channel = PLATFORM_TO_CHANNEL[platform];
      if (!channel) {
        unknownPlatform++;
        continue;
      }

      // Match product from pre-loaded maps (fast, in-memory)
      let productId =
        productBySku.get(lookupSku) ||
        productBySellerSku.get(lookupSku) ||
        productByBarcode.get(lookupSku);

      if (!productId) {
        unmatched++;
        unmatchedSkus.add(lookupSku);
        continue;
      }

      matched++;
      const qty = parseInt(String(row["Quantity"] || 0)) || 0;
      const rev = parseFloat(String(row["Amount After Discount for Product Details"] || 0)) || 0;

      if (qty <= 0) continue;

      const key = `${productId}-${year}-${month}-${channel}`;
      if (!aggregated[key]) {
        aggregated[key] = {
          productId,
          year,
          month,
          channel,
          units: 0,
          revenue: 0,
        };
      }
      aggregated[key].units += qty;
      aggregated[key].revenue += rev;
    }

    // Write to MonthlySales (upsert to overwrite any existing data for the same period)
    let salesRecords = 0;
    for (const data of Object.values(aggregated)) {
      await prisma.monthlySales.upsert({
        where: {
          productId_year_month_channel: {
            productId: data.productId,
            year: data.year,
            month: data.month,
            channel: data.channel,
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
          channel: data.channel,
          unitsSold: data.units,
          revenue: Math.round(data.revenue * 100) / 100,
          enteredBy: user.id,
        },
      });
      salesRecords++;
    }

    return NextResponse.json({
      success: true,
      totalRows,
      cancelled,
      missingSku,
      missingDate,
      unknownPlatform,
      matched,
      unmatched,
      unmatchedSkus: Array.from(unmatchedSkus).slice(0, 50),
      salesRecordsUpdated: salesRecords,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Import failed" },
      { status: 500 }
    );
  }
}
