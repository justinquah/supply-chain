import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized } from "@/lib/auth-guard";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; slipId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const { slipId } = await params;

  const slip = await prisma.paymentSlip.findUnique({
    where: { id: slipId },
  });

  if (!slip) {
    return NextResponse.json({ error: "Slip not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(slip.fileData), {
    headers: {
      "Content-Type": slip.mimeType,
      "Content-Disposition": `attachment; filename="${slip.fileName}"`,
      "Content-Length": String(slip.fileSize),
    },
  });
}
