import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  // Admin and Finance can update payment status
  if (user.role !== "ADMIN" && user.role !== "FINANCE") return forbidden();

  const { id } = await params;
  const body = await req.json();

  const data: any = {};
  if (body.status) data.status = body.status;
  if (body.paidDate) data.paidDate = new Date(body.paidDate);
  if (body.notes !== undefined) data.notes = body.notes;
  if (body.invoiceRef !== undefined) data.invoiceRef = body.invoiceRef;

  // If marking as paid, set paidDate to now if not provided
  if (data.status === "PAID" && !data.paidDate) {
    data.paidDate = new Date();
  }

  const payment = await prisma.payment.update({
    where: { id },
    data,
  });

  return NextResponse.json(payment);
}
