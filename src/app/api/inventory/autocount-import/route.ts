import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import * as XLSX from "xlsx";

/**
 * Import AutoCount "Sold Unit Report" for offline wholesale sales.
 *
 * Expected columns:
 * - Check, Doc No, Doc Date, Debtor Code, Debtor Name
 * - Cancelled (F/T)
 * - Item Code, Detail Description (contains barcode)
 * - Qty, Unit Price, Total_1
 *
 * Behaviour:
 * - Filters rows where Cancelled = "T"
 * - Matches products by Item Code (sku) or extracts barcode from Detail Description
 * - Aggregates by product + year + month
 * - Writes to MonthlySales with channel = "AUTOCOUNT"
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
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: null });

    if (rows.length === 0) {
      return NextResponse.json({ error: "File is empty" }, { status: 400 });
    }

    let totalRows = rows.length;
    let cancelled = 0;
    let missingItem = 0;
    let missingDate = 0;
    let unmatched = 0;
    let matched = 0;
    const unmatchedSkus: Set<string> = new Set();

    const aggregated: Record<
      string,
      {
        productId: string;
        year: number;
        month: number;
        units: number;
        revenue: number;
      }
    > = {};

    function excelSerialToDate(serial: number): Date {
      return new Date((serial - 25569) * 86400 * 1000);
    }

    // Pre-load all products into memory for fast lookup
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

    for (const row of rows) {
      // Filter cancelled (Cancelled column = "T")
      const isCancelled = String(row["Cancelled"] || "").toUpperCase() === "T";
      if (isCancelled) {
        cancelled++;
        continue;
      }

      // Get item code or extract barcode from Detail Description
      const itemCode = String(row["Item Code"] || "").trim();
      const description = String(row["Detail Description"] || "").trim();

      let lookupSku = itemCode;
      let lookupBarcode: string | null = null;

      // Extract barcode (13-digit) from description
      const barcodeMatch = description.match(/(955101\d{7})/);
      if (barcodeMatch) lookupBarcode = barcodeMatch[1];

      if (!lookupSku && !lookupBarcode) {
        missingItem++;
        continue;
      }

      // Parse Doc Date (Excel date serial)
      const docDateRaw = row["Doc Date"];
      if (!docDateRaw) {
        missingDate++;
        continue;
      }

      let docDate: Date;
      if (typeof docDateRaw === "number") {
        docDate = excelSerialToDate(docDateRaw);
      } else {
        docDate = new Date(String(docDateRaw));
      }

      if (isNaN(docDate.getTime())) {
        missingDate++;
        continue;
      }

      const year = docDate.getFullYear();
      const month = docDate.getMonth() + 1;

      // Match product from pre-loaded maps (fast, in-memory)
      let productId: string | undefined;
      if (lookupSku) {
        productId = productBySku.get(lookupSku) || productBySellerSku.get(lookupSku);
      }
      if (!productId && lookupBarcode) {
        productId = productByBarcode.get(lookupBarcode);
      }

      if (!productId) {
        unmatched++;
        if (lookupSku) unmatchedSkus.add(lookupSku);
        continue;
      }

      matched++;
      const qty = parseInt(String(row["Qty"] || 0)) || 0;
      const rev = parseFloat(String(row["Total_1"] || row["Total"] || 0)) || 0;

      if (qty <= 0) continue;

      const key = `${productId}-${year}-${month}`;
      if (!aggregated[key]) {
        aggregated[key] = {
          productId,
          year,
          month,
          units: 0,
          revenue: 0,
        };
      }
      aggregated[key].units += qty;
      aggregated[key].revenue += rev;
    }

    // Batch upsert via raw SQL (single round-trip instead of N round-trips)
    const aggregatedList = Object.values(aggregated);
    let salesRecords = 0;
    if (aggregatedList.length > 0) {
      // Build a single multi-row INSERT ... ON CONFLICT DO UPDATE
      // Uses SQLite's UPSERT syntax (supported by Turso/libsql)
      const now = new Date().toISOString();
      const valueChunks: string[] = [];
      const params: any[] = [];
      for (const d of aggregatedList) {
        const id = `cm${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
        valueChunks.push("(?, ?, ?, ?, ?, ?, ?, ?, ?)");
        params.push(
          id,
          d.productId,
          d.year,
          d.month,
          "AUTOCOUNT",
          d.units,
          Math.round(d.revenue * 100) / 100,
          user.id,
          now
        );
      }
      const sql = `
        INSERT INTO MonthlySales (id, productId, year, month, channel, unitsSold, revenue, enteredBy, createdAt)
        VALUES ${valueChunks.join(",")}
        ON CONFLICT (productId, year, month, channel) DO UPDATE SET
          unitsSold = excluded.unitsSold,
          revenue = excluded.revenue
      `;
      await prisma.$executeRawUnsafe(sql, ...params);
      salesRecords = aggregatedList.length;
    }

    return NextResponse.json({
      success: true,
      totalRows,
      cancelled,
      missingItem,
      missingDate,
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
