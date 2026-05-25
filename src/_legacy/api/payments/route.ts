import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import { addLogisticsPayment } from "@/lib/payment-scheduler";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status");
  const payee = searchParams.get("payee"); // SUPPLIER or LOGISTICS
  const purchaseOrderId = searchParams.get("purchaseOrderId");
  const upcoming = searchParams.get("upcoming"); // "true" for next 30 days

  const where: any = {};
  if (status) where.status = status;
  if (payee) where.payee = payee;
  if (purchaseOrderId) where.purchaseOrderId = purchaseOrderId;

  // Suppliers see only payments to them
  if (user.role === "SUPPLIER") {
    where.payee = "SUPPLIER";
    where.payeeUserId = user.id;
  }

  // Logistics see only payments to them
  if (user.role === "LOGISTICS") {
    where.payee = "LOGISTICS";
    where.payeeUserId = user.id;
  }

  // Upcoming filter: pending payments due in next 30 days
  if (upcoming === "true") {
    const now = new Date();
    const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    where.status = "PENDING";
    where.dueDate = { lte: thirtyDays };
  }

  const payments = await prisma.payment.findMany({
    where,
    include: {
      purchaseOrder: {
        select: {
          id: true,
          poNumber: true,
          currency: true,
          supplier: { select: { id: true, name: true, companyName: true } },
          shipment: { select: { eta: true, status: true } },
        },
      },
      _count: { select: { paymentSlips: true } },
    },
    orderBy: { dueDate: "asc" },
  });

  // Mark overdue payments
  const now = new Date();
  const result = payments.map((p) => ({
    ...p,
    isOverdue: p.status === "PENDING" && new Date(p.dueDate) < now,
  }));

  return NextResponse.json(result);
}

// POST - Add logistics fee payment
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return forbidden();

  const body = await req.json();
  const {
    purchaseOrderId,
    logisticsUserId,
    type,
    description,
    amount,
    currency,
    dueDate,
    invoiceRef,
    notes,
  } = body;

  if (!purchaseOrderId || !type || !amount || !dueDate) {
    return NextResponse.json(
      { error: "purchaseOrderId, type, amount, and dueDate required" },
      { status: 400 }
    );
  }

  const payment = await addLogisticsPayment({
    purchaseOrderId,
    logisticsUserId: logisticsUserId || null,
    type,
    description: description || type,
    amount: parseFloat(amount),
    currency: currency || "RM",
    dueDate: new Date(dueDate),
    invoiceRef: invoiceRef || undefined,
    notes: notes || undefined,
  });

  return NextResponse.json(payment, { status: 201 });
}
