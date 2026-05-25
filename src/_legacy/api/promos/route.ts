import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const { searchParams } = req.nextUrl;
  const year = searchParams.get("year");
  const month = searchParams.get("month");

  const where: any = { isActive: true };
  if (year) where.year = parseInt(year);
  if (month) where.month = parseInt(month);

  const promos = await prisma.promo.findMany({
    where,
    include: {
      products: {
        include: {
          product: { select: { id: true, sku: true, sellerSku: true, name: true } },
        },
      },
    },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  return NextResponse.json(promos);
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const body = await req.json();
  const { name, year, month, channel, upliftType, notes, products } = body;

  if (!name || !year || !month || !products?.length) {
    return NextResponse.json(
      { error: "Name, year, month, and at least one product required" },
      { status: 400 }
    );
  }

  const promo = await prisma.promo.create({
    data: {
      name,
      year: parseInt(year),
      month: parseInt(month),
      channel: channel || null,
      upliftType: upliftType || "UNITS",
      notes: notes || null,
      products: {
        create: products.map((p: { productId: string; upliftValue: number }) => ({
          productId: p.productId,
          upliftValue: p.upliftValue,
        })),
      },
    },
    include: {
      products: {
        include: {
          product: { select: { id: true, sku: true, name: true } },
        },
      },
    },
  });

  return NextResponse.json(promo, { status: 201 });
}
