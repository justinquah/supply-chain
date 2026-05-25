import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import { createSupplierPayments } from "@/lib/payment-scheduler";
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
  const { eta, etd, portOfOrigin, portOfDest, logisticsUserId } = body;

  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { lineItems: true },
  });

  if (!po) {
    return NextResponse.json({ error: "PO not found" }, { status: 404 });
  }

  if (po.status !== "DRAFT") {
    return NextResponse.json(
      { error: "Only draft POs can be confirmed" },
      { status: 400 }
    );
  }

  // Update PO status
  const updatedPO = await prisma.purchaseOrder.update({
    where: { id },
    data: {
      status: "CONFIRMED",
      confirmedAt: new Date(),
    },
  });

  // Create shipment record with assigned logistics partner
  const shipment = await prisma.shipment.create({
    data: {
      purchaseOrderId: id,
      status: "PENDING",
      eta: eta ? new Date(eta) : null,
      etd: etd ? new Date(etd) : null,
      portOfOrigin: portOfOrigin || null,
      portOfDest: portOfDest || "Port Klang",
      logisticsUserId: logisticsUserId || null,
    },
  });

  // Notify assigned logistics partner
  if (logisticsUserId) {
    await createNotification({
      userId: logisticsUserId,
      type: "SHIPMENT_UPDATE",
      title: "New Shipment Assigned",
      message: `Shipment for ${po.poNumber} has been assigned to you. ${eta ? `ETA: ${new Date(eta).toLocaleDateString()}` : ""}`,
      link: `/shipments/${shipment.id}`,
    });
  }

  // Create supplier payment schedule
  const etaDate = eta ? new Date(eta) : null;
  const payments = await createSupplierPayments(
    id,
    po.supplierId,
    po.totalAmount,
    po.currency,
    po.depositPercent,
    po.balanceDueDays,
    etaDate
  );

  return NextResponse.json({
    purchaseOrder: updatedPO,
    shipment,
    payments,
  });
}
