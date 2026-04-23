"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUS_COLORS,
  DOCUMENT_TYPE_LABELS,
} from "@/lib/constants";
import { format } from "date-fns";

type Shipment = {
  id: string;
  status: string;
  eta: string | null;
  etd: string | null;
  portOfOrigin: string | null;
  portOfDest: string;
  shippingLine: string | null;
  vesselName: string | null;
  containerNumber: string | null;
  createdAt: string;
  purchaseOrder: {
    id: string;
    poNumber: string;
    status: string;
    totalAmount: number;
    currency: string;
    supplier: { id: string; name: string; companyName: string | null };
  };
  _count: { documents: number };
  documentChecklist: {
    BL: boolean;
    COMMERCIAL_INVOICE: boolean;
    PACKING_LIST: boolean;
    K1: boolean;
  };
};

export default function ShipmentsPage() {
  const { data: session } = useSession();
  const user = session?.user as any;

  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("");

  async function loadShipments() {
    const url = filterStatus
      ? `/api/shipments?status=${filterStatus}`
      : "/api/shipments";
    const res = await fetch(url);
    if (res.ok) setShipments(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    loadShipments();
  }, [filterStatus]);

  const statuses = [
    "PENDING",
    "SHIPPED",
    "IN_TRANSIT",
    "AT_PORT",
    "CUSTOMS_CLEARANCE",
    "CLEARED",
    "DELIVERED",
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Shipments</h1>
        <p className="text-sm text-gray-500">
          Track shipments, manage documents, and update status
        </p>
      </div>

      {/* Status Filters */}
      <div className="flex gap-2 flex-wrap">
        <Button
          variant={filterStatus === "" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilterStatus("")}
        >
          All ({shipments.length})
        </Button>
        {statuses.map((s) => (
          <Button
            key={s}
            variant={filterStatus === s ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterStatus(s)}
          >
            {SHIPMENT_STATUS_LABELS[s]}
          </Button>
        ))}
      </div>

      {/* Shipments Table */}
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
                    <th className="p-3 font-medium">Route</th>
                    <th className="p-3 font-medium">ETA</th>
                    <th className="p-3 font-medium">Documents</th>
                    <th className="p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shipments.map((s) => (
                    <tr key={s.id} className="border-b hover:bg-gray-50">
                      <td className="p-3 font-mono font-medium">
                        {s.purchaseOrder.poNumber}
                      </td>
                      <td className="p-3">
                        <Badge className={SHIPMENT_STATUS_COLORS[s.status]}>
                          {SHIPMENT_STATUS_LABELS[s.status]}
                        </Badge>
                      </td>
                      <td className="p-3">
                        {s.purchaseOrder.supplier.companyName ||
                          s.purchaseOrder.supplier.name}
                      </td>
                      <td className="p-3 text-gray-500 text-xs">
                        {s.portOfOrigin && s.portOfDest
                          ? `${s.portOfOrigin} → ${s.portOfDest}`
                          : s.portOfDest || "-"}
                      </td>
                      <td className="p-3">
                        {s.eta
                          ? format(new Date(s.eta), "dd MMM yyyy")
                          : "-"}
                      </td>
                      <td className="p-3">
                        <div className="flex gap-1">
                          {(
                            ["BL", "COMMERCIAL_INVOICE", "PACKING_LIST", "K1"] as const
                          ).map((docType) => (
                            <span
                              key={docType}
                              className={`inline-block w-2 h-2 rounded-full ${
                                s.documentChecklist[docType]
                                  ? "bg-green-500"
                                  : "bg-gray-300"
                              }`}
                              title={`${DOCUMENT_TYPE_LABELS[docType]}: ${
                                s.documentChecklist[docType]
                                  ? "Uploaded"
                                  : "Missing"
                              }`}
                            />
                          ))}
                          <span className="text-xs text-gray-400 ml-1">
                            {s._count.documents}/4
                          </span>
                        </div>
                      </td>
                      <td className="p-3">
                        <Link href={`/shipments/${s.id}`}>
                          <Button variant="ghost" size="sm">
                            View
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {shipments.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="p-6 text-center text-gray-500"
                      >
                        No shipments found
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
