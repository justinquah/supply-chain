import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized } from "@/lib/auth-guard";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status");

  const where: any = {};
  if (status) where.status = status;

  // Suppliers see shipments for their POs only
  if (user.role === "SUPPLIER") {
    where.purchaseOrder = { supplierId: user.id };
  }

  // Logistics only see shipments assigned to them
  if (user.role === "LOGISTICS") {
    where.logisticsUserId = user.id;
  }

  // Finance sees all shipments (to track related payments)

  const shipments = await prisma.shipment.findMany({
    where,
    include: {
      purchaseOrder: {
        select: {
          id: true,
          poNumber: true,
          status: true,
          totalAmount: true,
          currency: true,
          supplier: { select: { id: true, name: true, companyName: true } },
        },
      },
      _count: { select: { documents: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Add document checklist status
  const result = await Promise.all(
    shipments.map(async (s) => {
      const docs = await prisma.shipmentDocument.findMany({
        where: { shipmentId: s.id },
        select: { type: true },
      });
      const docTypes = docs.map((d) => d.type);
      return {
        ...s,
        documentChecklist: {
          BL: docTypes.includes("BL"),
          COMMERCIAL_INVOICE: docTypes.includes("COMMERCIAL_INVOICE"),
          PACKING_LIST: docTypes.includes("PACKING_LIST"),
          K1: docTypes.includes("K1"),
        },
      };
    })
  );

  return NextResponse.json(result);
}
