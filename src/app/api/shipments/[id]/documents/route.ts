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

  const docs = await prisma.shipmentDocument.findMany({
    where: { shipmentId: id },
    select: {
      id: true,
      type: true,
      fileName: true,
      fileSize: true,
      mimeType: true,
      notes: true,
      createdAt: true,
      uploadedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(docs);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  // Admin, Logistics can upload documents. K1 only by admin.
  if (user.role !== "ADMIN" && user.role !== "LOGISTICS") return forbidden();

  const { id } = await params;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const type = formData.get("type") as string;
  const notes = formData.get("notes") as string | null;

  if (!file || !type) {
    return NextResponse.json(
      { error: "File and document type required" },
      { status: 400 }
    );
  }

  // K1 can only be uploaded by admin
  if (type === "K1" && user.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Only admin can upload K1 documents" },
      { status: 403 }
    );
  }

  const validTypes = [
    "BL",
    "COMMERCIAL_INVOICE",
    "PACKING_LIST",
    "K1",
    "OTHER",
  ];
  if (!validTypes.includes(type)) {
    return NextResponse.json(
      { error: "Invalid document type" },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const doc = await prisma.shipmentDocument.create({
    data: {
      shipmentId: id,
      type,
      fileName: file.name,
      fileData: buffer,
      fileSize: buffer.length,
      mimeType: file.type || "application/octet-stream",
      uploadedById: user.id,
      notes: notes || null,
    },
    select: {
      id: true,
      type: true,
      fileName: true,
      fileSize: true,
      createdAt: true,
    },
  });

  return NextResponse.json(doc, { status: 201 });
}
