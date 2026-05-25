import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import { recalculateBalanceDueDate } from "@/lib/payment-scheduler";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  // Admin and Supplier can update ETA
  if (user.role !== "ADMIN" && user.role !== "SUPPLIER") return forbidden();

  const { id } = await params;
  const body = await req.json();
  const { newEta, reason } = body;

  if (!newEta) {
    return NextResponse.json(
      { error: "newEta is required" },
      { status: 400 }
    );
  }

  const shipment = await prisma.shipment.findUnique({
    where: { id },
  });

  if (!shipment) {
    return NextResponse.json(
      { error: "Shipment not found" },
      { status: 404 }
    );
  }

  // Suppliers can only update ETA on their own shipments
  if (user.role === "SUPPLIER") {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: shipment.purchaseOrderId },
    });
    if (!po || po.supplierId !== user.id) return forbidden();
  }

  // Create ETA update audit record
  await prisma.eTAUpdate.create({
    data: {
      shipmentId: id,
      previousEta: shipment.eta,
      newEta: new Date(newEta),
      reason: reason || null,
      updatedById: user.id,
    },
  });

  // Update shipment ETA
  const updated = await prisma.shipment.update({
    where: { id },
    data: { eta: new Date(newEta) },
  });

  // Recalculate balance payment due date
  await recalculateBalanceDueDate(
    shipment.purchaseOrderId,
    new Date(newEta)
  );

  return NextResponse.json(updated);
}
