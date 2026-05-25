import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import { notifyRole } from "@/lib/notifications";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "SUPPLIER" && user.role !== "ADMIN") return forbidden();

  const { id } = await params;
  const body = await req.json();
  const { lineItems } = body;
  // lineItems: [{ lineItemId, batchNumber }]

  if (!lineItems?.length) {
    return NextResponse.json({ error: "lineItems required" }, { status: 400 });
  }

  // Verify supplier owns this PO
  if (user.role === "SUPPLIER") {
    const po = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po || po.supplierId !== user.id) return forbidden();
  }

  const updates = [];
  for (const item of lineItems) {
    updates.push(
      prisma.pOLineItem.update({
        where: { id: item.lineItemId },
        data: { batchNumber: item.batchNumber || null },
      })
    );
  }

  await Promise.all(updates);

  // Notify admin
  const po = await prisma.purchaseOrder.findUnique({ where: { id }, select: { poNumber: true } });
  if (po) {
    await notifyRole("ADMIN", "BATCH_UPDATED", "Batch Numbers Updated",
      `Supplier updated batch numbers for ${po.poNumber}`,
      `/purchase-orders/${id}`);
  }

  return NextResponse.json({ success: true, updated: updates.length });
}
