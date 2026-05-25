import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import { resolveMarketplaceSku } from "@/lib/sku-mapping";
import * as XLSX from "xlsx";

/**
 * Bulk import monthly sales from Excel/CSV
 *
 * Expected columns (flexible matching):
 * - SKU / Seller SKU / Item Code / Barcode (one of these)
 * - Year / Month (e.g. 2026, 4) OR Date (YYYY-MM or YYYY-MM-DD)
 * - Channel (SHOPEE, LAZADA, TIKTOK, AUTOCOUNT, MANUAL)
 * - Units Sold / Quantity / Qty
 * - Revenue / Amount / Total (optional)
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const defaultChannel = (formData.get("defaultChannel") as string) || "MANUAL";

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

    // Normalize column names (case-insensitive)
    function findKey(row: any, candidates: string[]): string | null {
      const keys = Object.keys(row);
      for (const candidate of candidates) {
        const match = keys.find((k) => k.toLowerCase().replace(/[\s_-]+/g, "") === candidate.toLowerCase().replace(/[\s_-]+/g, ""));
        if (match) return match;
      }
      return null;
    }

    const sampleRow = rows[0];
    const skuKey = findKey(sampleRow, ["sellersku", "seller sku", "sku", "itemcode", "item code", "item_code", "barcode"]);
    const yearKey = findKey(sampleRow, ["year"]);
    const monthKey = findKey(sampleRow, ["month"]);
    const dateKey = findKey(sampleRow, ["date", "period", "month_year"]);
    const channelKey = findKey(sampleRow, ["channel", "platform", "marketplace"]);
    const unitsKey = findKey(sampleRow, ["unitssold", "units sold", "units", "quantity", "qty", "unit"]);
    const revenueKey = findKey(sampleRow, ["revenue", "amount", "total", "sales", "gmv"]);

    if (!skuKey) {
      return NextResponse.json({
        error: "Could not find SKU column. Expected: SKU, Seller SKU, Item Code, or Barcode",
        availableColumns: Object.keys(sampleRow),
      }, { status: 400 });
    }

    if (!unitsKey) {
      return NextResponse.json({
        error: "Could not find Units Sold column. Expected: Units Sold, Quantity, or Qty",
        availableColumns: Object.keys(sampleRow),
      }, { status: 400 });
    }

    if (!dateKey && (!yearKey || !monthKey)) {
      return NextResponse.json({
        error: "Could not find date. Expected: Date column OR Year + Month columns",
        availableColumns: Object.keys(sampleRow),
      }, { status: 400 });
    }

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Aggregate by product+year+month+channel
    const aggregated: Record<string, { productId: string; year: number; month: number; channel: string; units: number; revenue: number }> = {};

    const unmatched: Set<string> = new Set();

    for (const [idx, row] of rows.entries()) {
      const rawSku = String(row[skuKey] || "").trim();
      if (!rawSku) { skipped++; continue; }

      // Parse date
      let year: number, month: number;
      if (dateKey && row[dateKey]) {
        const dateVal = String(row[dateKey]);
        // Handle YYYY-MM, YYYY-MM-DD, or Excel date serial
        if (typeof row[dateKey] === "number") {
          // Excel date serial number
          const excelDate = new Date((row[dateKey] - 25569) * 86400 * 1000);
          year = excelDate.getFullYear();
          month = excelDate.getMonth() + 1;
        } else {
          const parts = dateVal.split(/[-/]/);
          year = parseInt(parts[0]);
          month = parseInt(parts[1]);
        }
      } else {
        year = parseInt(String(row[yearKey!]));
        month = parseInt(String(row[monthKey!]));
      }

      if (!year || !month || month < 1 || month > 12) {
        errors.push(`Row ${idx + 2}: Invalid date`);
        skipped++;
        continue;
      }

      // Channel
      let channel = defaultChannel;
      if (channelKey && row[channelKey]) {
        const ch = String(row[channelKey]).trim().toUpperCase();
        if (["SHOPEE", "LAZADA", "TIKTOK", "AUTOCOUNT", "MANUAL"].includes(ch)) {
          channel = ch;
        }
      }

      const units = parseInt(String(row[unitsKey] || 0));
      const revenue = revenueKey ? parseFloat(String(row[revenueKey] || 0)) : 0;

      if (units <= 0) { skipped++; continue; }

      // Resolve SKU through mapping rules (handles bundles like ABCX6, ABC+CDE, etc.)
      const decomposed = await resolveMarketplaceSku(rawSku, units);

      if (decomposed.length === 0) {
        errors.push(`Row ${idx + 2}: No product/mapping found for SKU "${rawSku}"`);
        unmatched.add(rawSku);
        skipped++;
        continue;
      }

      // Revenue is split proportionally across components based on unit count
      const totalComponentUnits = decomposed.reduce((a, b) => a + b.units, 0);

      for (const component of decomposed) {
        const componentRevenue = totalComponentUnits > 0
          ? (revenue * component.units) / totalComponentUnits
          : 0;

        const key = `${component.productId}-${year}-${month}-${channel}`;
        if (!aggregated[key]) {
          aggregated[key] = {
            productId: component.productId,
            year,
            month,
            channel,
            units: 0,
            revenue: 0,
          };
        }
        aggregated[key].units += component.units;
        aggregated[key].revenue += componentRevenue;
      }
    }

    // Upsert aggregated sales
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
      imported++;
    }

    return NextResponse.json({
      success: true,
      totalRows: rows.length,
      imported,
      skipped,
      errors: errors.slice(0, 10),
      unmatchedSkus: Array.from(unmatched).slice(0, 50),
      columnsDetected: {
        sku: skuKey,
        date: dateKey || `${yearKey}+${monthKey}`,
        channel: channelKey || `default: ${defaultChannel}`,
        units: unitsKey,
        revenue: revenueKey || "not provided",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Import failed" },
      { status: 500 }
    );
  }
}
