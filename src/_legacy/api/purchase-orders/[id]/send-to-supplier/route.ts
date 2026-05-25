import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import { createNotification } from "@/lib/notifications";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const { id } = await params;
  const body = await req.json();
  const { requestedEta } = body;

  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { supplier: true },
  });

  if (!po) {
    return NextResponse.json({ error: "PO not found" }, { status: 404 });
  }

  if (po.status !== "DRAFT") {
    return NextResponse.json({ error: "Only draft POs can be sent to supplier" }, { status: 400 });
  }

  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: {
      status: "PENDING_SUPPLIER",
      requestedEta: requestedEta ? new Date(requestedEta) : null,
      sentToSupplierAt: new Date(),
    },
  });

  // Notify the supplier
  await createNotification({
    userId: po.supplierId,
    type: "PO_SENT",
    title: "New Purchase Order",
    message: `New PO ${po.poNumber} sent for your review. Total: ${po.currency} ${po.totalAmount.toFixed(2)}${requestedEta ? `. Requested ETA: ${new Date(requestedEta).toLocaleDateString()}` : ""}`,
    link: `/purchase-orders/${po.id}`,
  });

  return NextResponse.json(updated);
}
