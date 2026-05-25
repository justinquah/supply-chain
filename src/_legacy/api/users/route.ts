import { NextRequest, NextResponse } from "next/server";
import bcryptjs from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import { createUserSchema } from "@/types";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const { searchParams } = req.nextUrl;
  const role = searchParams.get("role");

  const where: any = {};
  if (role) where.role = role;

  // Suppliers only see their own profile
  if (user.role === "SUPPLIER") {
    where.id = user.id;
  }

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      companyName: true,
      phone: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const body = await req.json();
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { email, password, name, role, companyName, phone } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "A user with this email already exists" },
      { status: 409 }
    );
  }

  const passwordHash = await bcryptjs.hash(password, 12);

  const newUser = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
      role,
      companyName: companyName || null,
      phone: phone || null,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      companyName: true,
      phone: true,
      isActive: true,
    },
  });

  return NextResponse.json(newUser, { status: 201 });
}
