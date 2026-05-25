import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";

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
      supplier: {
        select: { id: true, name: true, companyName: true, email: true, phone: true },
      },
      createdBy: { select: { id: true, name: true } },
      lineItems: {
        include: {
          product: {
            select: {
              id: true,
              sku: true,
              sellerSku: true,
              barcode: true,
              name: true,
              weightPerUnit: true,
              volumePerUnit: true,
            },
          },
        },
      },
      shipment: {
        include: {
          documents: {
            select: { id: true, type: true, fileName: true, createdAt: true },
          },
          etaUpdates: {
            orderBy: { createdAt: "desc" },
            take: 5,
          },
        },
      },
      payments: {
        include: {
          _count: { select: { paymentSlips: true } },
        },
        orderBy: { dueDate: "asc" },
      },
    },
  });

  if (!po) {
    return NextResponse.json({ error: "PO not found" }, { status: 404 });
  }

  // Suppliers can only see their own POs
  if (user.role === "SUPPLIER" && po.supplierId !== user.id) {
    return forbidden();
  }

  return NextResponse.json(po);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const { id } = await params;
  const body = await req.json();

  // Only allow updating draft POs
  const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "PO not found" }, { status: 404 });
  }

  if (existing.status !== "DRAFT" && !body.status) {
    return NextResponse.json(
      { error: "Can only edit draft POs" },
      { status: 400 }
    );
  }

  const po = await prisma.purchaseOrder.update({
    where: { id },
    data: body,
    include: {
      supplier: { select: { id: true, name: true, companyName: true } },
      lineItems: {
        include: {
          product: { select: { id: true, sku: true, sellerSku: true, name: true } },
        },
      },
    },
  });

  return NextResponse.json(po);
}
