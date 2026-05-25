import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const { searchParams } = req.nextUrl;
  const productId = searchParams.get("productId");
  const year = searchParams.get("year");
  const month = searchParams.get("month");
  const channel = searchParams.get("channel");

  const where: any = {};
  if (productId) where.productId = productId;
  if (year) where.year = parseInt(year);
  if (month) where.month = parseInt(month);
  if (channel) where.channel = channel;

  const sales = await prisma.monthlySales.findMany({
    where,
    include: {
      product: {
        select: { id: true, sku: true, sellerSku: true, name: true },
      },
    },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  return NextResponse.json(sales);
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const body = await req.json();

  // Support bulk entry
  const entries = Array.isArray(body) ? body : [body];

  const results = [];
  for (const entry of entries) {
    const { productId, year, month, channel, unitsSold, revenue } = entry;

    if (!productId || !year || !month || unitsSold === undefined) {
      results.push({ error: "Missing required fields", entry });
      continue;
    }

    const ch = channel || "MANUAL";

    const result = await prisma.monthlySales.upsert({
      where: {
        productId_year_month_channel: {
          productId,
          year: parseInt(year),
          month: parseInt(month),
          channel: ch,
        },
      },
      update: {
        unitsSold: parseInt(unitsSold),
        revenue: revenue ? parseFloat(revenue) : 0,
      },
      create: {
        productId,
        year: parseInt(year),
        month: parseInt(month),
        channel: ch,
        unitsSold: parseInt(unitsSold),
        revenue: revenue ? parseFloat(revenue) : 0,
        enteredBy: user.id,
      },
    });

    results.push(result);
  }

  return NextResponse.json(results, { status: 201 });
}
