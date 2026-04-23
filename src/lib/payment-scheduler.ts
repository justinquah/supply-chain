import { prisma } from "./prisma";
import { addDays } from "date-fns";

/**
 * Create SUPPLIER payment schedule when a PO is confirmed.
 * Creates DEPOSIT payment (due now) and BALANCE payment (due ETA + balanceDueDays).
 */
export async function createSupplierPayments(
  purchaseOrderId: string,
  supplierId: string,
  totalAmount: number,
  currency: string,
  depositPercent: number,
  balanceDueDays: number,
  eta: Date | null
) {
  const payments = [];

  const depositAmount =
    Math.round(totalAmount * (depositPercent / 100) * 100) / 100;
  const balanceAmount =
    Math.round((totalAmount - depositAmount) * 100) / 100;

  // Deposit payment - due now
  if (depositAmount > 0) {
    payments.push(
      await prisma.payment.create({
        data: {
          purchaseOrderId,
          payee: "SUPPLIER",
          payeeUserId: supplierId,
          type: "DEPOSIT",
          description: `Supplier deposit (${depositPercent}%)`,
          amount: depositAmount,
          currency,
          dueDate: new Date(),
          status: "PENDING",
        },
      })
    );
  }

  // Balance payment - due ETA + balanceDueDays
  if (balanceAmount > 0) {
    const balanceDueDate = eta
      ? addDays(eta, balanceDueDays)
      : addDays(new Date(), 90);

    payments.push(
      await prisma.payment.create({
        data: {
          purchaseOrderId,
          payee: "SUPPLIER",
          payeeUserId: supplierId,
          type: "BALANCE",
          description: `Supplier balance (${balanceDueDays} days after ETA)`,
          amount: balanceAmount,
          currency,
          dueDate: balanceDueDate,
          status: "PENDING",
        },
      })
    );
  }

  return payments;
}

/**
 * Add LOGISTICS fee payments to a PO.
 * Called when logistics fees are known (after customs clearance).
 */
export async function addLogisticsPayment(params: {
  purchaseOrderId: string;
  logisticsUserId: string;
  type: string; // LOCAL_FEES, SST, CUSTOMS, TRANSPORT, OTHER
  description: string;
  amount: number;
  currency?: string;
  dueDate: Date;
  invoiceRef?: string;
  notes?: string;
}) {
  return prisma.payment.create({
    data: {
      purchaseOrderId: params.purchaseOrderId,
      payee: "LOGISTICS",
      payeeUserId: params.logisticsUserId,
      type: params.type,
      description: params.description,
      amount: params.amount,
      currency: params.currency || "RM",
      dueDate: params.dueDate,
      invoiceRef: params.invoiceRef || null,
      notes: params.notes || null,
      status: "PENDING",
    },
  });
}

/**
 * Recalculate supplier balance payment due date when ETA changes
 */
export async function recalculateBalanceDueDate(
  purchaseOrderId: string,
  newEta: Date
) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
  });

  if (!po) return null;

  const balancePayment = await prisma.payment.findFirst({
    where: {
      purchaseOrderId,
      payee: "SUPPLIER",
      type: "BALANCE",
      status: "PENDING",
    },
  });

  if (!balancePayment) return null;

  const newDueDate = addDays(newEta, po.balanceDueDays);

  return prisma.payment.update({
    where: { id: balancePayment.id },
    data: { dueDate: newDueDate },
  });
}
