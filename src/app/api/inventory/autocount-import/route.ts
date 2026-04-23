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
      // Excel stores dates as days since 1900-01-00 (with leap year bug)
      return new Date((serial - 25569) * 86400 * 1000);
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

      // Match product
      const orClauses: any[] = [];
      if (lookupSku) {
        orClauses.push({ sku: lookupSku });
        orClauses.push({ sellerSku: lookupSku });
      }
      if (lookupBarcode) orClauses.push({ barcode: lookupBarcode });

      const product = await prisma.product.findFirst({
        where: { OR: orClauses },
        select: { id: true },
      });

      if (!product) {
        unmatched++;
        if (lookupSku) unmatchedSkus.add(lookupSku);
        continue;
      }

      matched++;
      const qty = parseInt(String(row["Qty"] || 0)) || 0;
      const rev = parseFloat(String(row["Total_1"] || row["Total"] || 0)) || 0;

      if (qty <= 0) continue;

      const key = `${product.id}-${year}-${month}`;
      if (!aggregated[key]) {
        aggregated[key] = {
          productId: product.id,
          year,
          month,
          units: 0,
          revenue: 0,
        };
      }
      aggregated[key].units += qty;
      aggregated[key].revenue += rev;
    }

    let salesRecords = 0;
    for (const data of Object.values(aggregated)) {
      await prisma.monthlySales.upsert({
        where: {
          productId_year_month_channel: {
            productId: data.productId,
            year: data.year,
            month: data.month,
            channel: "AUTOCOUNT",
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
          channel: "AUTOCOUNT",
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
