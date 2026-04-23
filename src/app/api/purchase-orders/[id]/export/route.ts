import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized } from "@/lib/auth-guard";
import * as XLSX from "xlsx";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const { id } = await params;

  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      createdBy: { select: { name: true } },
      lineItems: {
        include: {
          product: {
            select: { sku: true, sellerSku: true, barcode: true, name: true },
          },
        },
      },
    },
  });

  if (!po) {
    return NextResponse.json({ error: "PO not found" }, { status: 404 });
  }

  // Build workbook
  const wb = XLSX.utils.book_new();

  // Header info
  const headerData = [
    ["PURCHASE ORDER"],
    [],
    ["PO Number:", po.poNumber],
    ["Date:", po.createdAt.toISOString().split("T")[0]],
    ["Status:", po.status],
    [],
    ["Supplier:", po.supplier.companyName || po.supplier.name],
    ["Email:", po.supplier.email],
    [],
    ["Container Type:", po.containerType || "TBD"],
    ["Currency:", po.currency],
    ["Deposit:", `${po.depositPercent}% (${po.currency} ${po.depositAmount.toFixed(2)})`],
    ["Balance Due:", `${po.balanceDueDays} days after ETA`],
    [],
  ];

  // Line items table
  const lineItemHeaders = [
    "No.",
    "Seller SKU",
    "SKU",
    "Barcode",
    "Product Name",
    "Qty",
    "Unit Cost",
    "Total Cost",
    "Weight (kg)",
    "Volume (CBM)",
  ];

  const lineItemRows = po.lineItems.map((li, i) => [
    i + 1,
    li.product.sellerSku || "",
    li.product.sku,
    li.product.barcode || "",
    li.product.name,
    li.quantity,
    li.unitCost,
    li.totalCost,
    li.weightSubtotal,
    li.volumeSubtotal,
  ]);

  // Summary row
  const summaryRows = [
    [],
    [
      "",
      "",
      "",
      "",
      "TOTAL",
      po.lineItems.reduce((a, b) => a + b.quantity, 0),
      "",
      po.totalAmount,
      po.totalWeight,
      po.totalVolume,
    ],
  ];

  const sheetData = [
    ...headerData,
    lineItemHeaders,
    ...lineItemRows,
    ...summaryRows,
  ];

  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  // Set column widths
  ws["!cols"] = [
    { wch: 5 },
    { wch: 15 },
    { wch: 25 },
    { wch: 15 },
    { wch: 40 },
    { wch: 8 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Purchase Order");

  // Generate buffer
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buf, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${po.poNumber}.xlsx"`,
    },
  });
}
