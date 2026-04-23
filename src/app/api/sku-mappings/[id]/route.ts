import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const { id } = await params;
  const body = await req.json();

  const data: any = {};
  if (body.description !== undefined) data.description = body.description;
  if (body.isActive !== undefined) data.isActive = body.isActive;

  if (body.components) {
    data.components = {
      deleteMany: {},
      create: body.components.map((c: any) => ({
        productId: c.productId,
        quantity: parseFloat(c.quantity),
      })),
    };
  }

  const mapping = await prisma.skuMapping.update({
    where: { id },
    data,
    include: {
      components: {
        include: { product: { select: { id: true, sku: true, name: true } } },
      },
    },
  });

  return NextResponse.json(mapping);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const { id } = await params;
  await prisma.skuMapping.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
