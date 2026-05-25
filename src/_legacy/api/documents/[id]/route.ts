import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized } from "@/lib/auth-guard";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const { id } = await params;

  const doc = await prisma.shipmentDocument.findUnique({
    where: { id },
  });

  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(doc.fileData), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `attachment; filename="${doc.fileName}"`,
      "Content-Length": String(doc.fileSize),
    },
  });
}
