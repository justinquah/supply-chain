import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import { generatePONumber } from "@/lib/po-number-generator";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status");
  const supplierId = searchParams.get("supplierId");

  const where: any = {};
  if (status) where.status = status;

  // Suppliers only see their own POs
  if (user.role === "SUPPLIER") {
    where.supplierId = user.id;
  } else if (supplierId) {
    where.supplierId = supplierId;
  }

  // Finance can see all POs (read-only)
  // Logistics can't see POs directly (they see shipments)
  if (user.role === "LOGISTICS") {
    return NextResponse.json([]);
  }

  const pos = await prisma.purchaseOrder.findMany({
    where,
    include: {
      supplier: { select: { id: true, name: true, companyName: true } },
      createdBy: { select: { id: true, name: true } },
      _count: { select: { lineItems: true } },
      shipment: { select: { id: true, status: true, eta: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(pos);
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const body = await req.json();
  const {
    supplierId,
    containerType,
    depositPercent = 30,
    balanceDueDays = 45,
    currency = "RMB",
    notes,
    lineItems,
  } = body;

  if (!supplierId || !lineItems?.length) {
    return NextResponse.json(
      { error: "Supplier and at least one line item required" },
      { status: 400 }
    );
  }

  // Get product details for calculations
  const productIds = lineItems.map((li: any) => li.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
  });

  const productMap = new Map(products.map((p) => [p.id, p]));

  // Calculate totals
  let totalWeight = 0;
  let totalVolume = 0;
  let totalAmount = 0;

  const processedLineItems = lineItems.map((li: any) => {
    const product = productMap.get(li.productId);
    if (!product) throw new Error(`Product ${li.productId} not found`);

    const qty = parseInt(li.quantity);
    const cost = parseFloat(li.unitCost || product.unitCost);
    const lineCost = Math.round(qty * cost * 100) / 100;
    const lineWeight = Math.round(qty * product.weightPerUnit * 100) / 100;
    const lineVolume =
      Math.round(qty * product.volumePerUnit * 10000) / 10000;

    totalWeight += lineWeight;
    totalVolume += lineVolume;
    totalAmount += lineCost;

    return {
      productId: li.productId,
      quantity: qty,
      unitCost: cost,
      totalCost: lineCost,
      weightSubtotal: lineWeight,
      volumeSubtotal: lineVolume,
      suggestedQty: li.suggestedQty ? parseInt(li.suggestedQty) : null,
      notes: li.notes || null,
    };
  });

  totalAmount = Math.round(totalAmount * 100) / 100;
  const depositAmount =
    Math.round(totalAmount * (depositPercent / 100) * 100) / 100;

  const poNumber = await generatePONumber();

  const po = await prisma.purchaseOrder.create({
    data: {
      poNumber,
      supplierId,
      createdById: user.id,
      containerType: containerType || null,
      totalWeight: Math.round(totalWeight * 100) / 100,
      totalVolume: Math.round(totalVolume * 10000) / 10000,
      totalAmount,
      depositPercent: depositPercent || 0,
      depositAmount,
      balanceDueDays: balanceDueDays || 45,
      currency: currency || "RMB",
      notes: notes || null,
      lineItems: {
        create: processedLineItems,
      },
    },
    include: {
      supplier: { select: { id: true, name: true, companyName: true } },
      createdBy: { select: { id: true, name: true } },
      lineItems: {
        include: {
          product: {
            select: { id: true, sku: true, sellerSku: true, name: true },
          },
        },
      },
    },
  });

  return NextResponse.json(po, { status: 201 });
}
