import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized } from "@/lib/auth-guard";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const series = await prisma.productSeries.findMany({
    where: { isActive: true },
    include: {
      category: { select: { id: true, name: true } },
      _count: { select: { products: true } },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(series);
}
