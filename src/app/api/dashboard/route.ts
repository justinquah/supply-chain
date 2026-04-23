import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized } from "@/lib/auth-guard";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const now = new Date();

  if (user.role === "ADMIN") {
    return NextResponse.json(await getAdminDashboard(now));
  } else if (user.role === "FINANCE") {
    return NextResponse.json(await getFinanceDashboard(now));
  } else if (user.role === "SUPPLIER") {
    return NextResponse.json(await getSupplierDashboard(user.id, now));
  } else if (user.role === "LOGISTICS") {
    return NextResponse.json(await getLogisticsDashboard(now));
  }

  return NextResponse.json({});
}

async function getAdminDashboard(now: Date) {
  const [
    activePOs,
    draftPOs,
    totalProducts,
    lowStockProducts,
    pendingPayments,
    overduePayments,
    activeShipments,
    customsShipments,
    recentPOs,
    upcomingPayments,
  ] = await Promise.all([
    prisma.purchaseOrder.count({
      where: { status: { in: ["CONFIRMED", "IN_TRANSIT", "CUSTOMS"] } },
    }),
    prisma.purchaseOrder.count({ where: { status: "DRAFT" } }),
    prisma.product.count({ where: { isActive: true } }),
    prisma.product.count({
      where: {
        isActive: true,
        currentStock: { lte: prisma.product.fields.reorderPoint },
      },
    }).catch(() => 0), // Fallback if self-ref doesn't work
    prisma.payment.count({ where: { status: "PENDING" } }),
    prisma.payment.count({
      where: { status: "PENDING", dueDate: { lt: now } },
    }),
    prisma.shipment.count({
      where: { status: { in: ["SHIPPED", "IN_TRANSIT", "AT_PORT"] } },
    }),
    prisma.shipment.count({ where: { status: "CUSTOMS_CLEARANCE" } }),
    prisma.purchaseOrder.findMany({
      where: { status: { not: "CANCELLED" } },
      include: {
        supplier: { select: { name: true, companyName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.payment.findMany({
      where: { status: "PENDING" },
      include: {
        purchaseOrder: {
          select: { poNumber: true, supplier: { select: { companyName: true, name: true } } },
        },
      },
      orderBy: { dueDate: "asc" },
      take: 8,
    }),
  ]);

  // Low stock: products where currentStock < reorderPoint
  const lowStock = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, currentStock: true, reorderPoint: true, name: true, sku: true },
  });
  const lowStockCount = lowStock.filter(p => p.currentStock <= p.reorderPoint).length;

  // Supplier payment totals
  const supplierPending = await prisma.payment.aggregate({
    where: { payee: "SUPPLIER", status: "PENDING" },
    _sum: { amount: true },
  });
  const logisticsPending = await prisma.payment.aggregate({
    where: { payee: "LOGISTICS", status: "PENDING" },
    _sum: { amount: true },
  });

  return {
    role: "ADMIN",
    stats: {
      activePOs,
      draftPOs,
      totalProducts,
      lowStockProducts: lowStockCount,
      pendingPayments,
      overduePayments,
      activeShipments,
      customsShipments,
      supplierPaymentDue: supplierPending._sum.amount || 0,
      logisticsPaymentDue: logisticsPending._sum.amount || 0,
    },
    recentPOs,
    upcomingPayments,
  };
}

async function getFinanceDashboard(now: Date) {
  const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [
    pendingCount,
    overdueCount,
    paidThisMonth,
    supplierPending,
    logisticsPending,
    upcomingPayments,
    overduePayments,
  ] = await Promise.all([
    prisma.payment.count({ where: { status: "PENDING" } }),
    prisma.payment.count({
      where: { status: "PENDING", dueDate: { lt: now } },
    }),
    prisma.payment.count({
      where: {
        status: "PAID",
        paidDate: {
          gte: new Date(now.getFullYear(), now.getMonth(), 1),
        },
      },
    }),
    prisma.payment.aggregate({
      where: { payee: "SUPPLIER", status: "PENDING" },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: { payee: "LOGISTICS", status: "PENDING" },
      _sum: { amount: true },
    }),
    prisma.payment.findMany({
      where: { status: "PENDING", dueDate: { gte: now, lte: thirtyDays } },
      include: {
        purchaseOrder: {
          select: { poNumber: true, supplier: { select: { companyName: true, name: true } } },
        },
      },
      orderBy: { dueDate: "asc" },
      take: 10,
    }),
    prisma.payment.findMany({
      where: { status: "PENDING", dueDate: { lt: now } },
      include: {
        purchaseOrder: {
          select: { poNumber: true, supplier: { select: { companyName: true, name: true } } },
        },
      },
      orderBy: { dueDate: "asc" },
    }),
  ]);

  return {
    role: "FINANCE",
    stats: {
      pendingCount,
      overdueCount,
      paidThisMonth,
      supplierPaymentDue: supplierPending._sum.amount || 0,
      logisticsPaymentDue: logisticsPending._sum.amount || 0,
    },
    upcomingPayments,
    overduePayments,
  };
}

async function getSupplierDashboard(userId: string, now: Date) {
  const [
    activePOs,
    totalPOs,
    pendingShipments,
    pendingPayments,
    recentPOs,
    myPayments,
  ] = await Promise.all([
    prisma.purchaseOrder.count({
      where: {
        supplierId: userId,
        status: { in: ["CONFIRMED", "IN_TRANSIT", "CUSTOMS"] },
      },
    }),
    prisma.purchaseOrder.count({ where: { supplierId: userId } }),
    prisma.shipment.count({
      where: {
        purchaseOrder: { supplierId: userId },
        status: { in: ["PENDING", "SHIPPED"] },
      },
    }),
    prisma.payment.count({
      where: { payee: "SUPPLIER", payeeUserId: userId, status: "PENDING" },
    }),
    prisma.purchaseOrder.findMany({
      where: { supplierId: userId },
      include: {
        shipment: { select: { status: true, eta: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.payment.findMany({
      where: { payee: "SUPPLIER", payeeUserId: userId },
      include: {
        purchaseOrder: { select: { poNumber: true } },
      },
      orderBy: { dueDate: "desc" },
      take: 5,
    }),
  ]);

  const paymentTotal = await prisma.payment.aggregate({
    where: { payee: "SUPPLIER", payeeUserId: userId, status: "PAID" },
    _sum: { amount: true },
  });

  return {
    role: "SUPPLIER",
    stats: {
      activePOs,
      totalPOs,
      pendingShipments,
      pendingPayments,
      totalPaid: paymentTotal._sum.amount || 0,
    },
    recentPOs,
    myPayments,
  };
}

async function getLogisticsDashboard(now: Date) {
  const [
    activeShipments,
    customsClearance,
    totalDocuments,
    pendingPayments,
    shipments,
    myPayments,
  ] = await Promise.all([
    prisma.shipment.count({
      where: { status: { in: ["SHIPPED", "IN_TRANSIT", "AT_PORT", "CUSTOMS_CLEARANCE"] } },
    }),
    prisma.shipment.count({ where: { status: "CUSTOMS_CLEARANCE" } }),
    prisma.shipmentDocument.count(),
    prisma.payment.count({
      where: { payee: "LOGISTICS", status: "PENDING" },
    }),
    prisma.shipment.findMany({
      where: { status: { not: "DELIVERED" } },
      include: {
        purchaseOrder: {
          select: {
            poNumber: true,
            supplier: { select: { companyName: true, name: true } },
          },
        },
        _count: { select: { documents: true } },
      },
      orderBy: { eta: "asc" },
      take: 10,
    }),
    prisma.payment.findMany({
      where: { payee: "LOGISTICS" },
      include: {
        purchaseOrder: { select: { poNumber: true } },
      },
      orderBy: { dueDate: "desc" },
      take: 5,
    }),
  ]);

  // Check missing documents per shipment
  const shipmentDocs = await Promise.all(
    shipments.map(async (s) => {
      const docs = await prisma.shipmentDocument.findMany({
        where: { shipmentId: s.id },
        select: { type: true },
      });
      const types = docs.map((d) => d.type);
      return {
        ...s,
        missingDocs: ["BL", "COMMERCIAL_INVOICE", "PACKING_LIST", "K1"].filter(
          (t) => !types.includes(t)
        ),
      };
    })
  );

  return {
    role: "LOGISTICS",
    stats: {
      activeShipments,
      customsClearance,
      totalDocuments,
      pendingPayments,
    },
    shipments: shipmentDocs,
    myPayments,
  };
}
