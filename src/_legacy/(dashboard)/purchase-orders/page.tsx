"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  PO_STATUS_LABELS,
  PO_STATUS_COLORS,
  formatCurrency,
  CONTAINER_TYPE_LABELS,
} from "@/lib/constants";
import { format } from "date-fns";

type PO = {
  id: string;
  poNumber: string;
  status: string;
  containerType: string | null;
  totalAmount: number;
  currency: string;
  depositPercent: number;
  createdAt: string;
  confirmedAt: string | null;
  supplier: { id: string; name: string; companyName: string | null };
  createdBy: { id: string; name: string };
  _count: { lineItems: number };
  shipment: { id: string; status: string; eta: string | null } | null;
};

export default function PurchaseOrdersPage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const isAdmin = user?.role === "ADMIN";

  const [pos, setPOs] = useState<PO[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("");

  async function loadPOs() {
    const url = filterStatus
      ? `/api/purchase-orders?status=${filterStatus}`
      : "/api/purchase-orders";
    const res = await fetch(url);
    if (res.ok) setPOs(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    loadPOs();
  }, [filterStatus]);

  const statuses = [
    "DRAFT",
    "PENDING_SUPPLIER",
    "CONFIRMED",
    "IN_TRANSIT",
    "CUSTOMS",
    "RECEIVED",
    "COMPLETED",
    "CANCELLED",
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Purchase Orders</h1>
          <p className="text-sm text-gray-500">{pos.length} purchase orders</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Link href="/purchase-orders/import">
              <Button variant="outline">Import POs</Button>
            </Link>
            <Link href="/purchase-orders/new">
              <Button>Create PO</Button>
            </Link>
          </div>
        )}
      </div>

      {/* Status Filters */}
      <div className="flex gap-2 flex-wrap">
        <Button
          variant={filterStatus === "" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilterStatus("")}
        >
          All
        </Button>
        {statuses.map((s) => (
          <Button
            key={s}
            variant={filterStatus === s ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterStatus(s)}
          >
            {PO_STATUS_LABELS[s]}
          </Button>
        ))}
      </div>

      {/* PO List */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-sm text-gray-500">Loading...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left">
                    <th className="p-3 font-medium">PO Number</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium">Supplier</th>
                    <th className="p-3 font-medium">Container</th>
                    <th className="p-3 font-medium text-right">Items</th>
                    <th className="p-3 font-medium text-right">Total</th>
                    <th className="p-3 font-medium">ETA</th>
                    <th className="p-3 font-medium">Created</th>
                    <th className="p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pos.map((po) => (
                    <tr key={po.id} className="border-b hover:bg-gray-50">
                      <td className="p-3 font-mono font-medium">
                        {po.poNumber}
                      </td>
                      <td className="p-3">
                        <Badge className={PO_STATUS_COLORS[po.status]}>
                          {PO_STATUS_LABELS[po.status]}
                        </Badge>
                      </td>
                      <td className="p-3">
                        {po.supplier.companyName || po.supplier.name}
                      </td>
                      <td className="p-3 text-gray-500">
                        {po.containerType
                          ? CONTAINER_TYPE_LABELS[po.containerType] ||
                            po.containerType
                          : "-"}
                      </td>
                      <td className="p-3 text-right">
                        {po._count.lineItems}
                      </td>
                      <td className="p-3 text-right font-medium">
                        {po.currency} {po.totalAmount.toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-3 text-gray-500">
                        {po.shipment?.eta
                          ? format(new Date(po.shipment.eta), "dd MMM yyyy")
                          : "-"}
                      </td>
                      <td className="p-3 text-gray-500">
                        {format(new Date(po.createdAt), "dd MMM yyyy")}
                      </td>
                      <td className="p-3">
                        <Link href={`/purchase-orders/${po.id}`}>
                          <Button variant="ghost" size="sm">
                            View
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {pos.length === 0 && (
                    <tr>
                      <td
                        colSpan={9}
                        className="p-6 text-center text-gray-500"
                      >
                        No purchase orders found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
