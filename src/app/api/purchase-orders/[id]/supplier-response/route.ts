import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import { createNotification, notifyRole } from "@/lib/notifications";
import { createSupplierPayments } from "@/lib/payment-scheduler";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "SUPPLIER") return forbidden();

  const { id } = await params;
  const body = await req.json();
  const { action, supplierNotes, supplierInvoiceNo, confirmedEta } = body;
  // action: "APPROVE" or "REJECT"

  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
  });

  if (!po) {
    return NextResponse.json({ error: "PO not found" }, { status: 404 });
  }

  if (po.supplierId !== user.id) return forbidden();

  if (po.status !== "PENDING_SUPPLIER") {
    return NextResponse.json({ error: "PO is not pending supplier approval" }, { status: 400 });
  }

  if (action === "APPROVE") {
    const eta = confirmedEta ? new Date(confirmedEta) : po.requestedEta;

    // Update PO to confirmed
    const updated = await prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        supplierNotes: supplierNotes || null,
        supplierInvoiceNo: supplierInvoiceNo || null,
      },
    });

    // Create shipment
    await prisma.shipment.create({
      data: {
        purchaseOrderId: id,
        status: "PENDING",
        eta: eta || null,
        portOfDest: "Port Klang",
      },
    });

    // Create supplier payments
    await createSupplierPayments(
      id,
      po.supplierId,
      po.totalAmount,
      po.currency,
      po.depositPercent,
      po.balanceDueDays,
      eta || null
    );

    // Notify admin and finance
    await notifyRole("ADMIN", "PO_APPROVED", "PO Approved by Supplier",
      `${po.poNumber} has been approved by the supplier.${supplierInvoiceNo ? ` Invoice: ${supplierInvoiceNo}` : ""}`,
      `/purchase-orders/${po.id}`);
    await notifyRole("FINANCE", "PO_APPROVED", "PO Confirmed - Payments Created",
      `${po.poNumber} confirmed. Deposit payment of ${po.currency} ${po.depositAmount.toFixed(2)} is due.`,
      `/payments`);

    return NextResponse.json(updated);
  } else if (action === "REJECT") {
    const updated = await prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: "DRAFT", // Back to draft for revision
        supplierNotes: supplierNotes || "Rejected by supplier",
      },
    });

    // Notify admin
    await notifyRole("ADMIN", "PO_REJECTED", "PO Rejected by Supplier",
      `${po.poNumber} was rejected. Reason: ${supplierNotes || "No reason given"}`,
      `/purchase-orders/${po.id}`);

    return NextResponse.json(updated);
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
