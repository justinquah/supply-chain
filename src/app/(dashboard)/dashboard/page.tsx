"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ROLE_LABELS,
  PO_STATUS_LABELS,
  PO_STATUS_COLORS,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUS_COLORS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_COLORS,
  DOCUMENT_TYPE_LABELS,
} from "@/lib/constants";
import { format } from "date-fns";

export default function DashboardPage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const role = user?.role || "ADMIN";

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }, []);

  if (loading) return <p className="p-6 text-gray-500">Loading dashboard...</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-gray-500">
          Welcome back, {user?.name}. You are logged in as {ROLE_LABELS[role]}.
        </p>
      </div>

      {role === "ADMIN" && data && <AdminDashboard data={data} />}
      {role === "FINANCE" && data && <FinanceDashboard data={data} />}
      {role === "SUPPLIER" && data && <SupplierDashboard data={data} />}
      {role === "LOGISTICS" && data && <LogisticsDashboard data={data} />}
    </div>
  );
}

function StatCard({ title, value, subtitle, color, href }: {
  title: string; value: string | number; subtitle: string; color?: string; href?: string;
}) {
  const content = (
    <Card className={href ? "hover:shadow-md cursor-pointer transition-shadow" : ""}>
      <CardContent className="pt-4">
        <div className="text-sm text-gray-500">{title}</div>
        <div className={`text-2xl font-bold ${color || ""}`}>{value}</div>
        <div className="text-xs text-gray-400 mt-1">{subtitle}</div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

function AdminDashboard({ data }: { data: any }) {
  const s = data.stats;
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Active POs" value={s.activePOs} subtitle={`${s.draftPOs} drafts pending`} href="/purchase-orders" />
        <StatCard title="Low Stock" value={s.lowStockProducts} subtitle={`of ${s.totalProducts} products`} color={s.lowStockProducts > 0 ? "text-red-600" : ""} href="/inventory" />
        <StatCard title="In Transit" value={s.activeShipments} subtitle={`${s.customsShipments} at customs`} href="/shipments" />
        <StatCard title="Overdue Payments" value={s.overduePayments} subtitle={`${s.pendingPayments} total pending`} color={s.overduePayments > 0 ? "text-red-600" : ""} href="/payments" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatCard title="Supplier Payments Due" value={`RMB ${s.supplierPaymentDue.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`} subtitle="COGS deposits + balances" />
        <StatCard title="Logistics Fees Due" value={`RM ${s.logisticsPaymentDue.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`} subtitle="Local fees, SST, customs, transport" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent POs */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Recent Purchase Orders</CardTitle>
            <Link href="/purchase-orders"><Button variant="ghost" size="sm">View All</Button></Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.recentPOs.map((po: any) => (
                <Link key={po.id} href={`/purchase-orders/${po.id}`} className="flex items-center justify-between p-2 rounded hover:bg-gray-50">
                  <div>
                    <span className="font-mono text-sm font-medium">{po.poNumber}</span>
                    <span className="text-xs text-gray-400 ml-2">{po.supplier.companyName || po.supplier.name}</span>
                  </div>
                  <Badge className={PO_STATUS_COLORS[po.status]}>{PO_STATUS_LABELS[po.status]}</Badge>
                </Link>
              ))}
              {data.recentPOs.length === 0 && <p className="text-sm text-gray-400">No purchase orders yet</p>}
            </div>
          </CardContent>
        </Card>

        {/* Upcoming Payments */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Upcoming Payments</CardTitle>
            <Link href="/payments"><Button variant="ghost" size="sm">View All</Button></Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.upcomingPayments.map((pmt: any) => (
                <div key={pmt.id} className="flex items-center justify-between p-2 rounded hover:bg-gray-50">
                  <div>
                    <span className="text-sm font-medium">{pmt.purchaseOrder.poNumber}</span>
                    <Badge variant="secondary" className={`ml-2 text-xs ${pmt.payee === "SUPPLIER" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"}`}>
                      {pmt.payee === "SUPPLIER" ? "Supplier" : "Logistics"}
                    </Badge>
                    <span className="text-xs text-gray-400 ml-2">{pmt.type}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium">{pmt.currency} {pmt.amount.toFixed(2)}</div>
                    <div className={`text-xs ${new Date(pmt.dueDate) < new Date() ? "text-red-500" : "text-gray-400"}`}>
                      {format(new Date(pmt.dueDate), "dd MMM")}
                    </div>
                  </div>
                </div>
              ))}
              {data.upcomingPayments.length === 0 && <p className="text-sm text-gray-400">No pending payments</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function FinanceDashboard({ data }: { data: any }) {
  const s = data.stats;
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard title="Pending Payments" value={s.pendingCount} subtitle="Awaiting payment" href="/payments" />
        <StatCard title="Overdue" value={s.overdueCount} subtitle="Past due date" color={s.overdueCount > 0 ? "text-red-600" : ""} href="/payments?status=PENDING" />
        <StatCard title="Paid This Month" value={s.paidThisMonth} subtitle="Completed this month" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatCard title="Supplier COGS Due" value={`RMB ${s.supplierPaymentDue.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`} subtitle="Deposits + balance payments" />
        <StatCard title="Logistics Fees Due" value={`RM ${s.logisticsPaymentDue.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`} subtitle="Local fees, SST, customs" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Overdue */}
        {data.overduePayments.length > 0 && (
          <Card className="border-red-200">
            <CardHeader>
              <CardTitle className="text-sm text-red-600">Overdue Payments</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data.overduePayments.map((pmt: any) => (
                  <div key={pmt.id} className="flex items-center justify-between p-2 bg-red-50 rounded">
                    <div>
                      <span className="text-sm font-medium">{pmt.purchaseOrder.poNumber}</span>
                      <span className="text-xs text-gray-500 ml-2">{pmt.type} - {pmt.payee}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-red-600">{pmt.currency} {pmt.amount.toFixed(2)}</div>
                      <div className="text-xs text-red-500">Due {format(new Date(pmt.dueDate), "dd MMM")}</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Upcoming */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Upcoming (Next 30 Days)</CardTitle>
            <Link href="/payments"><Button variant="ghost" size="sm">View All</Button></Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.upcomingPayments.map((pmt: any) => (
                <div key={pmt.id} className="flex items-center justify-between p-2 rounded hover:bg-gray-50">
                  <div>
                    <span className="text-sm font-medium">{pmt.purchaseOrder.poNumber}</span>
                    <Badge variant="secondary" className={`ml-2 text-xs ${pmt.payee === "SUPPLIER" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"}`}>
                      {pmt.payee === "SUPPLIER" ? "Supplier" : "Logistics"}
                    </Badge>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium">{pmt.currency} {pmt.amount.toFixed(2)}</div>
                    <div className="text-xs text-gray-400">{format(new Date(pmt.dueDate), "dd MMM yyyy")}</div>
                  </div>
                </div>
              ))}
              {data.upcomingPayments.length === 0 && <p className="text-sm text-gray-400">No upcoming payments</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function SupplierDashboard({ data }: { data: any }) {
  const s = data.stats;
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Active POs" value={s.activePOs} subtitle={`${s.totalPOs} total orders`} href="/purchase-orders" />
        <StatCard title="Pending Shipments" value={s.pendingShipments} subtitle="Awaiting dispatch" href="/shipments" />
        <StatCard title="Payments Pending" value={s.pendingPayments} subtitle="Awaiting receipt" href="/payments" />
        <StatCard title="Total Received" value={`${s.totalPaid.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`} subtitle="Payments received" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">My Purchase Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.recentPOs.map((po: any) => (
                <Link key={po.id} href={`/purchase-orders/${po.id}`} className="flex items-center justify-between p-2 rounded hover:bg-gray-50">
                  <div>
                    <span className="font-mono text-sm font-medium">{po.poNumber}</span>
                    {po.shipment?.eta && (
                      <span className="text-xs text-gray-400 ml-2">ETA: {format(new Date(po.shipment.eta), "dd MMM")}</span>
                    )}
                  </div>
                  <Badge className={PO_STATUS_COLORS[po.status]}>{PO_STATUS_LABELS[po.status]}</Badge>
                </Link>
              ))}
              {data.recentPOs.length === 0 && <p className="text-sm text-gray-400">No purchase orders</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">My Payments</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.myPayments.map((pmt: any) => (
                <div key={pmt.id} className="flex items-center justify-between p-2 rounded hover:bg-gray-50">
                  <div>
                    <span className="text-sm font-medium">{pmt.purchaseOrder.poNumber}</span>
                    <span className="text-xs text-gray-400 ml-2">{pmt.type}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium">{pmt.currency} {pmt.amount.toFixed(2)}</div>
                    <Badge className={PAYMENT_STATUS_COLORS[pmt.status]} >{PAYMENT_STATUS_LABELS[pmt.status]}</Badge>
                  </div>
                </div>
              ))}
              {data.myPayments.length === 0 && <p className="text-sm text-gray-400">No payments</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function LogisticsDashboard({ data }: { data: any }) {
  const s = data.stats;
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Active Shipments" value={s.activeShipments} subtitle="In processing" href="/shipments" />
        <StatCard title="Customs Clearance" value={s.customsClearance} subtitle="Awaiting clearance" color={s.customsClearance > 0 ? "text-amber-600" : ""} />
        <StatCard title="Documents Uploaded" value={s.totalDocuments} subtitle="BL, invoices, packing lists" />
        <StatCard title="Pending Fees" value={s.pendingPayments} subtitle="Awaiting payment" href="/payments" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Shipments to Process</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.shipments.map((ship: any) => (
                <Link key={ship.id} href={`/shipments/${ship.id}`} className="block p-3 rounded border hover:bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-sm font-medium">{ship.purchaseOrder.poNumber}</span>
                    <Badge className={SHIPMENT_STATUS_COLORS[ship.status]}>{SHIPMENT_STATUS_LABELS[ship.status]}</Badge>
                  </div>
                  <div className="text-xs text-gray-500">
                    {ship.purchaseOrder.supplier.companyName || ship.purchaseOrder.supplier.name}
                    {ship.eta && <span className="ml-2">ETA: {format(new Date(ship.eta), "dd MMM yyyy")}</span>}
                  </div>
                  {ship.missingDocs.length > 0 && (
                    <div className="flex gap-1 mt-2">
                      {ship.missingDocs.map((doc: string) => (
                        <Badge key={doc} variant="secondary" className="text-xs bg-amber-100 text-amber-700">
                          {DOCUMENT_TYPE_LABELS[doc] || doc} missing
                        </Badge>
                      ))}
                    </div>
                  )}
                </Link>
              ))}
              {data.shipments.length === 0 && <p className="text-sm text-gray-400">No active shipments</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">My Fee Payments</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.myPayments.map((pmt: any) => (
                <div key={pmt.id} className="flex items-center justify-between p-2 rounded hover:bg-gray-50">
                  <div>
                    <span className="text-sm font-medium">{pmt.purchaseOrder.poNumber}</span>
                    <span className="text-xs text-gray-400 ml-2">{pmt.type}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium">{pmt.currency} {pmt.amount.toFixed(2)}</div>
                    <Badge className={PAYMENT_STATUS_COLORS[pmt.status]}>{PAYMENT_STATUS_LABELS[pmt.status]}</Badge>
                  </div>
                </div>
              ))}
              {data.myPayments.length === 0 && <p className="text-sm text-gray-400">No fee payments</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
