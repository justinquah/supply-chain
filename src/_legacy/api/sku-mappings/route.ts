import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import { tryAutoParse, suggestMappings } from "@/lib/sku-mapping";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const { searchParams } = req.nextUrl;
  const search = searchParams.get("search");

  const where: any = {};
  if (search) where.marketplaceSku = { contains: search };

  const mappings = await prisma.skuMapping.findMany({
    where,
    include: {
      components: {
        include: {
          product: {
            select: { id: true, sku: true, sellerSku: true, name: true },
          },
        },
      },
    },
    orderBy: { marketplaceSku: "asc" },
  });

  return NextResponse.json(mappings);
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const body = await req.json();
  const { marketplaceSku, description, components, source } = body;

  if (!marketplaceSku || !components?.length) {
    return NextResponse.json(
      { error: "marketplaceSku and at least one component required" },
      { status: 400 }
    );
  }

  // Validate components exist
  for (const c of components) {
    if (!c.productId || !c.quantity || c.quantity <= 0) {
      return NextResponse.json(
        { error: "Each component needs productId and quantity > 0" },
        { status: 400 }
      );
    }
  }

  const mapping = await prisma.skuMapping.upsert({
    where: { marketplaceSku },
    update: {
      description: description || null,
      source: source || "MANUAL",
      isActive: true,
      components: {
        deleteMany: {},
        create: components.map((c: any) => ({
          productId: c.productId,
          quantity: parseFloat(c.quantity),
        })),
      },
    },
    create: {
      marketplaceSku,
      description: description || null,
      source: source || "MANUAL",
      components: {
        create: components.map((c: any) => ({
          productId: c.productId,
          quantity: parseFloat(c.quantity),
        })),
      },
    },
    include: {
      components: {
        include: {
          product: { select: { id: true, sku: true, name: true } },
        },
      },
    },
  });

  return NextResponse.json(mapping, { status: 201 });
}
