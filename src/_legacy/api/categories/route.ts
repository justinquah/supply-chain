import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const categories = await prisma.productCategory.findMany({
    where: { isActive: true },
    include: { _count: { select: { products: true } } },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(categories);
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const body = await req.json();
  if (!body.name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const category = await prisma.productCategory.create({
    data: {
      name: body.name,
      defaultTargetTurnover: body.defaultTargetTurnover ?? 6,
    },
  });

  return NextResponse.json(category, { status: 201 });
}
