import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import { generatePONumber } from "@/lib/po-number-generator";
import * as XLSX from "xlsx";

/**
 * Bulk import purchase orders from Excel
 *
 * Expected columns:
 * - PO Number (optional, will generate if blank)
 * - Supplier (email or company name)
 * - SKU / Seller SKU / Barcode (product identifier)
 * - Quantity
 * - Unit Cost
 * - Currency (optional, default RMB)
 * - Container Type (optional: 20FT/40FT/LCL)
 * - Deposit Percent (optional, default 30)
 * - Balance Due Days (optional, default 45)
 * - ETA (optional, YYYY-MM-DD)
 * - Notes (optional)
 *
 * Multiple rows with same PO Number = same PO with multiple line items
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

    const sampleRow = rows[0];
    const poNumKey = findKey(sampleRow, ["ponumber", "po number", "po", "po no"]);
    const supplierKey = findKey(sampleRow, ["supplier", "vendor", "supplieremail", "supplier email", "suppliername"]);
    const skuKey = findKey(sampleRow, ["sku", "sellersku", "seller sku", "itemcode", "item code", "barcode"]);
    const qtyKey = findKey(sampleRow, ["quantity", "qty", "unitssold", "units"]);
    const costKey = findKey(sampleRow, ["unitcost", "unit cost", "cost", "price", "unitprice"]);
    const currencyKey = findKey(sampleRow, ["currency", "curr"]);
    const containerKey = findKey(sampleRow, ["containertype", "container type", "container"]);
    const depositKey = findKey(sampleRow, ["depositpercent", "deposit percent", "deposit", "deposit %"]);
    const balanceDaysKey = findKey(sampleRow, ["balanceduedays", "balance due days", "balance days"]);
    const etaKey = findKey(sampleRow, ["eta", "expected arrival", "arrival date"]);
    const notesKey = findKey(sampleRow, ["notes", "remarks", "comment"]);

    if (!supplierKey || !skuKey || !qtyKey || !costKey) {
      return NextResponse.json({
        error: "Missing required columns. Need: Supplier, SKU, Quantity, Unit Cost",
        availableColumns: Object.keys(sampleRow),
      }, { status: 400 });
    }

    // Group rows by PO Number (or generate new ones for blank)
    const poGroups: Record<string, any[]> = {};
    let tempPOCount = 0;

    for (const row of rows) {
      let poNum = poNumKey ? String(row[poNumKey] || "").trim() : "";
      if (!poNum) {
        poNum = `__NEW_${tempPOCount++}`;
      }
      if (!poGroups[poNum]) poGroups[poNum] = [];
      poGroups[poNum].push(row);
    }

    const results: any[] = [];
    const errors: string[] = [];

    for (const [origPoNum, groupRows] of Object.entries(poGroups)) {
      const firstRow = groupRows[0];

      // Find supplier
      const supplierValue = String(firstRow[supplierKey] || "").trim();
      const supplier = await prisma.user.findFirst({
        where: {
          role: "SUPPLIER",
          OR: [
            { email: supplierValue },
            { companyName: supplierValue },
            { name: supplierValue },
          ],
        },
      });

      if (!supplier) {
        errors.push(`Supplier not found: ${supplierValue}`);
        continue;
      }

      // Check if PO already exists
      const isNew = origPoNum.startsWith("__NEW_");
      let finalPONum = isNew ? await generatePONumber() : origPoNum;

      if (!isNew) {
        const existing = await prisma.purchaseOrder.findUnique({
          where: { poNumber: finalPONum },
        });
        if (existing) {
          errors.push(`PO ${finalPONum} already exists`);
          continue;
        }
      }

      // Process line items
      const lineItems: any[] = [];
      let totalWeight = 0, totalVolume = 0, totalAmount = 0;

      for (const row of groupRows) {
        const sku = String(row[skuKey] || "").trim();
        const product = await prisma.product.findFirst({
          where: { OR: [{ sku }, { sellerSku: sku }, { barcode: sku }] },
        });

        if (!product) {
          errors.push(`PO ${finalPONum}: Product not found for SKU ${sku}`);
          continue;
        }

        const qty = parseInt(String(row[qtyKey] || 0));
        const cost = parseFloat(String(row[costKey] || 0));
        const lineCost = Math.round(qty * cost * 100) / 100;
        const lineWeight = Math.round(qty * product.weightPerUnit * 100) / 100;
        const lineVolume = Math.round(qty * product.volumePerUnit * 10000) / 10000;

        totalWeight += lineWeight;
        totalVolume += lineVolume;
        totalAmount += lineCost;

        lineItems.push({
          productId: product.id,
          quantity: qty,
          unitCost: cost,
          totalCost: lineCost,
          weightSubtotal: lineWeight,
          volumeSubtotal: lineVolume,
          notes: notesKey ? String(row[notesKey] || "") || null : null,
        });
      }

      if (lineItems.length === 0) {
        errors.push(`PO ${finalPONum}: No valid line items`);
        continue;
      }

      // Get PO-level settings from first row
      const currency = currencyKey ? String(firstRow[currencyKey] || "RMB") : "RMB";
      const containerType = containerKey ? String(firstRow[containerKey] || "") : null;
      const depositPercent = depositKey ? parseFloat(String(firstRow[depositKey] || 30)) : 30;
      const balanceDueDays = balanceDaysKey ? parseInt(String(firstRow[balanceDaysKey] || 45)) : 45;
      const notes = notesKey ? String(firstRow[notesKey] || "") || null : null;

      totalAmount = Math.round(totalAmount * 100) / 100;
      const depositAmount = Math.round(totalAmount * (depositPercent / 100) * 100) / 100;

      // Create PO
      const po = await prisma.purchaseOrder.create({
        data: {
          poNumber: finalPONum,
          supplierId: supplier.id,
          createdById: user.id,
          status: "DRAFT",
          containerType: containerType || null,
          totalWeight: Math.round(totalWeight * 100) / 100,
          totalVolume: Math.round(totalVolume * 10000) / 10000,
          totalAmount,
          depositPercent,
          depositAmount,
          balanceDueDays,
          currency,
          notes,
          lineItems: { create: lineItems },
        },
      });

      results.push({
        poNumber: po.poNumber,
        id: po.id,
        supplier: supplier.companyName || supplier.name,
        lineItems: lineItems.length,
        totalAmount: po.totalAmount,
      });
    }

    return NextResponse.json({
      success: true,
      totalGroups: Object.keys(poGroups).length,
      posCreated: results.length,
      errors: errors.slice(0, 20),
      pos: results,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Import failed" },
      { status: 500 }
    );
  }
}
