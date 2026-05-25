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

  const slips = await prisma.paymentSlip.findMany({
    where: { paymentId: id },
    select: {
      id: true,
      fileName: true,
      fileSize: true,
      mimeType: true,
      notes: true,
      createdAt: true,
      uploadedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(slips);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  // Admin and Finance can upload payment slips
  if (user.role !== "ADMIN" && user.role !== "FINANCE") return forbidden();

  const { id } = await params;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const notes = formData.get("notes") as string | null;

  if (!file) {
    return NextResponse.json({ error: "File required" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const slip = await prisma.paymentSlip.create({
    data: {
      paymentId: id,
      fileName: file.name,
      fileData: buffer,
      fileSize: buffer.length,
      mimeType: file.type || "application/octet-stream",
      uploadedById: user.id,
      notes: notes || null,
    },
    select: {
      id: true,
      fileName: true,
      fileSize: true,
      createdAt: true,
    },
  });

  return NextResponse.json(slip, { status: 201 });
}
