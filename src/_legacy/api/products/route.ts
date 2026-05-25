import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import { createProductSchema } from "@/types";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const { searchParams } = req.nextUrl;
  const categoryId = searchParams.get("categoryId");
  const supplierId = searchParams.get("supplierId");
  const search = searchParams.get("search");
  const activeOnly = searchParams.get("activeOnly") !== "false";

  const where: any = {};
  if (activeOnly) where.isActive = true;
  if (categoryId) where.categoryId = categoryId;

  // Suppliers only see their own products
  if (user.role === "SUPPLIER") {
    where.supplierId = user.id;
  } else if (supplierId) {
    where.supplierId = supplierId;
  }

  if (search) {
    where.OR = [
      { name: { contains: search } },
      { sku: { contains: search } },
      { sellerSku: { contains: search } },
      { barcode: { contains: search } },
    ];
  }

  const products = await prisma.product.findMany({
    where,
    include: {
      category: { select: { id: true, name: true } },
      series: { select: { id: true, name: true, packSize: true } },
      supplier: { select: { id: true, name: true, companyName: true } },
    },
    orderBy: [
      { series: { name: "asc" } },
      { variationName: "asc" },
      { name: "asc" },
    ],
  });

  return NextResponse.json(products);
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const body = await req.json();
  const parsed = createProductSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;

  // Check for duplicate SKU
  const existingSku = await prisma.product.findUnique({
    where: { sku: data.sku },
  });
  if (existingSku) {
    return NextResponse.json(
      { error: "A product with this SKU already exists" },
      { status: 409 }
    );
  }

  // Check for duplicate seller SKU if provided
  if ((body as any).sellerSku) {
    const existingSellerSku = await prisma.product.findUnique({
      where: { sellerSku: (body as any).sellerSku },
    });
    if (existingSellerSku) {
      return NextResponse.json(
        { error: "A product with this seller SKU already exists" },
        { status: 409 }
      );
    }
  }

  const product = await prisma.product.create({
    data: {
      ...data,
      sellerSku: (body as any).sellerSku || null,
      barcode: (body as any).barcode || null,
      targetTurnover: (body as any).targetTurnover || null,
      unitsPerCarton: data.unitsPerCarton ?? 1,
      minOrderQty: data.minOrderQty ?? 1,
      reorderPoint: data.reorderPoint ?? 0,
    },
    include: {
      category: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true, companyName: true } },
    },
  });

  return NextResponse.json(product, { status: 201 });
}
