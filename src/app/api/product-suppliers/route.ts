import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";

// Get supplier pricing for a product, or all pricings
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const { searchParams } = req.nextUrl;
  const productId = searchParams.get("productId");
  const supplierId = searchParams.get("supplierId");

  const where: any = { isActive: true };
  if (productId) where.productId = productId;
  if (supplierId) where.supplierId = supplierId;
  if (user.role === "SUPPLIER") where.supplierId = user.id;

  const pricings = await prisma.productSupplier.findMany({
    where,
    include: {
      product: { select: { id: true, sku: true, sellerSku: true, name: true, weightPerUnit: true, volumePerUnit: true, unitsPerCarton: true } },
      supplier: { select: { id: true, name: true, companyName: true } },
    },
    orderBy: { unitCost: "asc" },
  });

  return NextResponse.json(pricings);
}

// Add/update supplier pricing for a product
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const body = await req.json();
  const { productId, supplierId, unitCost, currency, leadTimeDays, transitDays, moq, isPreferred, notes } = body;

  if (!productId || !supplierId || unitCost === undefined) {
    return NextResponse.json({ error: "productId, supplierId, and unitCost required" }, { status: 400 });
  }

  const pricing = await prisma.productSupplier.upsert({
    where: { productId_supplierId: { productId, supplierId } },
    update: {
      unitCost: parseFloat(unitCost),
      currency: currency || "RMB",
      leadTimeDays: leadTimeDays ? parseInt(leadTimeDays) : 30,
      transitDays: transitDays ? parseInt(transitDays) : 21,
      moq: moq ? parseInt(moq) : 1,
      isPreferred: isPreferred ?? false,
      notes: notes || null,
    },
    create: {
      productId,
      supplierId,
      unitCost: parseFloat(unitCost),
      currency: currency || "RMB",
      leadTimeDays: leadTimeDays ? parseInt(leadTimeDays) : 30,
      transitDays: transitDays ? parseInt(transitDays) : 21,
      moq: moq ? parseInt(moq) : 1,
      isPreferred: isPreferred ?? false,
      notes: notes || null,
    },
    include: {
      product: { select: { id: true, sku: true, name: true } },
      supplier: { select: { id: true, name: true, companyName: true } },
    },
  });

  return NextResponse.json(pricing, { status: 201 });
}
