import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized } from "@/lib/auth-guard";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const partners = await prisma.user.findMany({
    where: { role: "LOGISTICS", isActive: true },
    select: {
      id: true,
      name: true,
      companyName: true,
      email: true,
      phone: true,
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(partners);
}
