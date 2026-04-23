import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import { createNotification } from "@/lib/notifications";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const { id } = await params;

  const shipment = await prisma.shipment.findUnique({
    where: { id },
    include: {
      purchaseOrder: {
        include: {
          supplier: {
            select: { id: true, name: true, companyName: true, email: true },
          },
          createdBy: { select: { id: true, name: true } },
          lineItems: {
            include: {
              product: {
                select: { id: true, sku: true, sellerSku: true, name: true },
              },
            },
          },
          payments: {
            include: { _count: { select: { paymentSlips: true } } },
            orderBy: { dueDate: "asc" },
          },
        },
      },
      documents: {
        include: {
          uploadedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      etaUpdates: {
        include: {
          updatedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!shipment) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  }

  // Suppliers can only see their own shipments
  if (
    user.role === "SUPPLIER" &&
    shipment.purchaseOrder.supplier.id !== user.id
  ) {
    return forbidden();
  }

  return NextResponse.json(shipment);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  // Admin and Logistics can update shipment status
  if (user.role !== "ADMIN" && user.role !== "LOGISTICS") return forbidden();

  const { id } = await params;
  const body = await req.json();

  const allowedFields: Record<string, boolean> = {
    status: true,
    shipmentRef: true,
    shippingLine: true,
    vesselName: true,
    containerNumber: true,
    portOfOrigin: true,
    portOfDest: true,
    actualArrival: true,
    logisticsUserId: true,
    notes: true,
  };

  const data: any = {};
  for (const [key, value] of Object.entries(body)) {
    if (allowedFields[key]) {
      data[key] = key === "actualArrival" && value ? new Date(value as string) : value;
    }
  }

  // If status changes to DELIVERED, also update PO status to RECEIVED
  if (data.status === "DELIVERED") {
    const shipment = await prisma.shipment.findUnique({
      where: { id },
      select: { purchaseOrderId: true },
    });
    if (shipment) {
      await prisma.purchaseOrder.update({
        where: { id: shipment.purchaseOrderId },
        data: { status: "RECEIVED" },
      });
    }
  }

  // If status changes to IN_TRANSIT, update PO status too
  if (data.status === "IN_TRANSIT") {
    const shipment = await prisma.shipment.findUnique({
      where: { id },
      select: { purchaseOrderId: true },
    });
    if (shipment) {
      await prisma.purchaseOrder.update({
        where: { id: shipment.purchaseOrderId },
        data: { status: "IN_TRANSIT" },
      });
    }
  }

  // If status changes to CUSTOMS_CLEARANCE, update PO status
  if (data.status === "CUSTOMS_CLEARANCE") {
    const shipment = await prisma.shipment.findUnique({
      where: { id },
      select: { purchaseOrderId: true },
    });
    if (shipment) {
      await prisma.purchaseOrder.update({
        where: { id: shipment.purchaseOrderId },
        data: { status: "CUSTOMS" },
      });
    }
  }

  // If assigning a logistics partner, notify them
  if (data.logisticsUserId) {
    const shipmentForNotif = await prisma.shipment.findUnique({
      where: { id },
      include: { purchaseOrder: { select: { poNumber: true } } },
    });
    if (shipmentForNotif) {
      await createNotification({
        userId: data.logisticsUserId,
        type: "SHIPMENT_UPDATE",
        title: "Shipment Assigned to You",
        message: `Shipment for ${shipmentForNotif.purchaseOrder.poNumber} has been assigned to your company for customs clearance and delivery.`,
        link: `/shipments/${id}`,
      });
    }
  }

  const updated = await prisma.shipment.update({
    where: { id },
    data,
  });

  return NextResponse.json(updated);
}
