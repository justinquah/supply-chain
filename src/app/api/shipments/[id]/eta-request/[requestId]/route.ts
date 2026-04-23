import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import { createNotification, notifyRole } from "@/lib/notifications";
import { recalculateBalanceDueDate } from "@/lib/payment-scheduler";

// Respond to an ETA change request (accept/decline)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; requestId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const { id, requestId } = await params;
  const body = await req.json();
  const { action, responseNote } = body;
  // action: "ACCEPT" or "DECLINE"

  const request = await prisma.eTAChangeRequest.findUnique({
    where: { id: requestId },
    include: {
      shipment: {
        include: {
          purchaseOrder: { select: { id: true, poNumber: true, supplierId: true } },
        },
      },
      requestedBy: { select: { id: true, name: true, role: true } },
    },
  });

  if (!request) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  if (request.status !== "PENDING") {
    return NextResponse.json({ error: "Request already responded to" }, { status: 400 });
  }

  const updated = await prisma.eTAChangeRequest.update({
    where: { id: requestId },
    data: {
      status: action === "ACCEPT" ? "ACCEPTED" : "DECLINED",
      respondedById: user.id,
      responseNote: responseNote || null,
      respondedAt: new Date(),
    },
  });

  const poNumber = request.shipment.purchaseOrder.poNumber;

  if (action === "ACCEPT") {
    // Update the actual shipment ETA
    await prisma.shipment.update({
      where: { id },
      data: { eta: request.requestedEta },
    });

    // Create ETA update audit trail
    await prisma.eTAUpdate.create({
      data: {
        shipmentId: id,
        previousEta: request.currentEta,
        newEta: request.requestedEta,
        reason: `ETA change request accepted: ${request.reason}`,
        updatedById: user.id,
      },
    });

    // Recalculate balance payment
    await recalculateBalanceDueDate(
      request.shipment.purchaseOrderId,
      request.requestedEta
    );

    // Notify requester
    await createNotification({
      userId: request.requestedBy.id,
      type: "ETA_REQUEST_RESPONSE",
      title: `ETA Change Accepted - ${poNumber}`,
      message: `Your ETA change request for ${poNumber} has been accepted. New ETA: ${request.requestedEta.toLocaleDateString()}`,
      link: `/shipments/${id}`,
    });

    // Notify finance about due date change
    await notifyRole("FINANCE", "ETA_CHANGED", `Payment Date Changed - ${poNumber}`,
      `ETA changed for ${poNumber}. Balance payment due date recalculated.`,
      `/payments`);
  } else {
    // Notify requester of decline
    await createNotification({
      userId: request.requestedBy.id,
      type: "ETA_REQUEST_RESPONSE",
      title: `ETA Change Declined - ${poNumber}`,
      message: `Your ETA change request for ${poNumber} was declined.${responseNote ? ` Reason: ${responseNote}` : ""}`,
      link: `/shipments/${id}`,
    });
  }

  return NextResponse.json(updated);
}
