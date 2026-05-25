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

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true, companyName: true } },
    },
  });

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  // Suppliers can only see their own products
  if (user.role === "SUPPLIER" && product.supplierId !== user.id) {
    return forbidden();
  }

  return NextResponse.json(product);
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

  // Check for duplicate seller SKU if being updated
  if (body.sellerSku) {
    const existing = await prisma.product.findFirst({
      where: { sellerSku: body.sellerSku, id: { not: id } },
    });
    if (existing) {
      return NextResponse.json(
        { error: "A product with this seller SKU already exists" },
        { status: 409 }
      );
    }
  }

  const product = await prisma.product.update({
    where: { id },
    data: body,
    include: {
      category: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true, companyName: true } },
    },
  });

  return NextResponse.json(product);
}
