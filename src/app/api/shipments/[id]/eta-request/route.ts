import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import { createNotification, notifyRole } from "@/lib/notifications";

// Create an ETA change request
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN" && user.role !== "SUPPLIER") return forbidden();

  const { id } = await params;
  const body = await req.json();
  const { requestedEta, reason } = body;

  if (!requestedEta || !reason) {
    return NextResponse.json({ error: "requestedEta and reason required" }, { status: 400 });
  }

  const shipment = await prisma.shipment.findUnique({
    where: { id },
    include: {
      purchaseOrder: { select: { poNumber: true, supplierId: true } },
    },
  });

  if (!shipment) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  }

  // Suppliers can only request on their own shipments
  if (user.role === "SUPPLIER" && shipment.purchaseOrder.supplierId !== user.id) {
    return forbidden();
  }

  const requestType = shipment.eta && new Date(requestedEta) < shipment.eta ? "EARLIER" : "DELAY";

  const request = await prisma.eTAChangeRequest.create({
    data: {
      shipmentId: id,
      requestedById: user.id,
      requestType,
      currentEta: shipment.eta || new Date(),
      requestedEta: new Date(requestedEta),
      reason,
    },
    include: {
      requestedBy: { select: { name: true, role: true } },
    },
  });

  // Notify the other party
  const poNumber = shipment.purchaseOrder.poNumber;
  if (user.role === "ADMIN") {
    // Admin requested → notify supplier
    await createNotification({
      userId: shipment.purchaseOrder.supplierId,
      type: "ETA_REQUEST",
      title: `ETA Change Request - ${poNumber}`,
      message: `${requestType === "EARLIER" ? "Earlier" : "Delayed"} shipment requested: ${reason}. New ETA: ${new Date(requestedEta).toLocaleDateString()}`,
      link: `/shipments/${id}`,
    });
  } else {
    // Supplier requested → notify admin
    await notifyRole("ADMIN", "ETA_REQUEST", `Supplier ETA Change - ${poNumber}`,
      `Supplier requests ${requestType === "EARLIER" ? "earlier" : "delayed"} shipment: ${reason}. New ETA: ${new Date(requestedEta).toLocaleDateString()}`,
      `/shipments/${id}`);
  }

  return NextResponse.json(request, { status: 201 });
}

// Get ETA change requests for a shipment
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const { id } = await params;

  const requests = await prisma.eTAChangeRequest.findMany({
    where: { shipmentId: id },
    include: {
      requestedBy: { select: { id: true, name: true, role: true, companyName: true } },
      respondedBy: { select: { id: true, name: true, role: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(requests);
}
