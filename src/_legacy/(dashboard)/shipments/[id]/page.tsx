"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUS_COLORS,
  DOCUMENT_TYPE_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_COLORS,
} from "@/lib/constants";
import { format } from "date-fns";

type ShipmentDetail = {
  id: string;
  status: string;
  eta: string | null;
  etd: string | null;
  actualArrival: string | null;
  portOfOrigin: string | null;
  portOfDest: string;
  shippingLine: string | null;
  vesselName: string | null;
  containerNumber: string | null;
  logisticsUserId: string | null;
  notes: string | null;
  purchaseOrder: {
    id: string;
    poNumber: string;
    totalAmount: number;
    currency: string;
    supplier: { id: string; name: string; companyName: string | null; email: string };
    createdBy: { id: string; name: string };
    lineItems: {
      id: string;
      quantity: number;
      unitCost: number;
      totalCost: number;
      product: { id: string; sku: string; sellerSku: string | null; name: string };
    }[];
    payments: {
      id: string;
      type: string;
      amount: number;
      dueDate: string;
      status: string;
      paidDate: string | null;
      _count: { paymentSlips: number };
    }[];
  };
  documents: {
    id: string;
    type: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    notes: string | null;
    createdAt: string;
    uploadedBy: { id: string; name: string };
  }[];
  etaUpdates: {
    id: string;
    previousEta: string | null;
    newEta: string;
    reason: string | null;
    createdAt: string;
    updatedBy: { id: string; name: string };
  }[];
};

const STATUS_FLOW = [
  "PENDING",
  "SHIPPED",
  "IN_TRANSIT",
  "AT_PORT",
  "CUSTOMS_CLEARANCE",
  "CLEARED",
  "DELIVERED",
];

export default function ShipmentDetailPage() {
  const params = useParams();
  const { data: session } = useSession();
  const user = session?.user as any;
  const isAdmin = user?.role === "ADMIN";
  const isLogistics = user?.role === "LOGISTICS";
  const isSupplier = user?.role === "SUPPLIER";
  const canUpdateStatus = isAdmin || isLogistics;
  const canUpdateETA = isAdmin || isSupplier;
  const canUploadDocs = isAdmin || isLogistics;

  const [shipment, setShipment] = useState<ShipmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [logisticsPartners, setLogisticsPartners] = useState<{ id: string; name: string; companyName: string | null }[]>([]);

  // ETA update
  const [showEtaForm, setShowEtaForm] = useState(false);
  const [etaForm, setEtaForm] = useState({ newEta: "", reason: "" });
  const [updatingEta, setUpdatingEta] = useState(false);

  // Status update
  const [showStatusForm, setShowStatusForm] = useState(false);
  const [statusForm, setStatusForm] = useState({
    status: "",
    shippingLine: "",
    vesselName: "",
    containerNumber: "",
    logisticsUserId: "",
    notes: "",
  });
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Document upload
  const [showDocForm, setShowDocForm] = useState(false);
  const [docType, setDocType] = useState("BL");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docNotes, setDocNotes] = useState("");
  const [uploading, setUploading] = useState(false);

  async function loadShipment() {
    const res = await fetch(`/api/shipments/${params.id}`);
    if (res.ok) {
      const data = await res.json();
      setShipment(data);
      setStatusForm({
        status: data.status,
        shippingLine: data.shippingLine || "",
        vesselName: data.vesselName || "",
        containerNumber: data.containerNumber || "",
        logisticsUserId: data.logisticsUserId || "",
        notes: data.notes || "",
      });
    }
    setLoading(false);
  }

  useEffect(() => {
    loadShipment();
    if (isAdmin) {
      fetch("/api/logistics-partners")
        .then((r) => r.json())
        .then(setLogisticsPartners)
        .catch(() => {});
    }
  }, [params.id]);

  async function handleEtaUpdate() {
    setUpdatingEta(true);
    await fetch(`/api/shipments/${params.id}/eta`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(etaForm),
    });
    setShowEtaForm(false);
    setUpdatingEta(false);
    loadShipment();
  }

  async function handleStatusUpdate() {
    setUpdatingStatus(true);
    await fetch(`/api/shipments/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(statusForm),
    });
    setShowStatusForm(false);
    setUpdatingStatus(false);
    loadShipment();
  }

  async function handleDocUpload() {
    if (!docFile) return;
    setUploading(true);

    const formData = new FormData();
    formData.append("file", docFile);
    formData.append("type", docType);
    if (docNotes) formData.append("notes", docNotes);

    await fetch(`/api/shipments/${params.id}/documents`, {
      method: "POST",
      body: formData,
    });

    setShowDocForm(false);
    setDocFile(null);
    setDocNotes("");
    setUploading(false);
    loadShipment();
  }

  if (loading) return <p className="p-6 text-gray-500">Loading...</p>;
  if (!shipment) return <p className="p-6 text-gray-500">Shipment not found</p>;

  const currentStatusIdx = STATUS_FLOW.indexOf(shipment.status);
  const docTypes = shipment.documents.map((d) => d.type);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold font-mono">
              {shipment.purchaseOrder.poNumber}
            </h1>
            <Badge className={SHIPMENT_STATUS_COLORS[shipment.status]}>
              {SHIPMENT_STATUS_LABELS[shipment.status]}
            </Badge>
          </div>
          <p className="text-sm text-gray-500">
            {shipment.purchaseOrder.supplier.companyName ||
              shipment.purchaseOrder.supplier.name}
          </p>
        </div>
        <div className="flex gap-2">
          {canUpdateETA && (
            <Button variant="outline" onClick={() => setShowEtaForm(true)}>
              Update ETA
            </Button>
          )}
          {canUpdateStatus && (
            <Button onClick={() => setShowStatusForm(true)}>
              Update Status
            </Button>
          )}
          {canUploadDocs && (
            <Button variant="outline" onClick={() => setShowDocForm(true)}>
              Upload Document
            </Button>
          )}
        </div>
      </div>

      {/* Status Timeline */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            {STATUS_FLOW.map((status, i) => {
              const isActive = i <= currentStatusIdx;
              const isCurrent = status === shipment.status;
              return (
                <div key={status} className="flex items-center flex-1">
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium ${
                        isCurrent
                          ? "bg-blue-600 text-white"
                          : isActive
                          ? "bg-green-600 text-white"
                          : "bg-gray-200 text-gray-500"
                      }`}
                    >
                      {isActive && !isCurrent ? "✓" : i + 1}
                    </div>
                    <span
                      className={`text-xs mt-1 text-center ${
                        isCurrent ? "font-medium" : "text-gray-400"
                      }`}
                    >
                      {SHIPMENT_STATUS_LABELS[status]}
                    </span>
                  </div>
                  {i < STATUS_FLOW.length - 1 && (
                    <div
                      className={`flex-1 h-0.5 mx-1 ${
                        i < currentStatusIdx ? "bg-green-600" : "bg-gray-200"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Shipping Details */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Shipping Details</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-500">Route</span>
              <span>
                {shipment.portOfOrigin || "TBD"} → {shipment.portOfDest}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">ETD</span>
              <span>
                {shipment.etd
                  ? format(new Date(shipment.etd), "dd MMM yyyy")
                  : "TBD"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">ETA</span>
              <span className="font-medium">
                {shipment.eta
                  ? format(new Date(shipment.eta), "dd MMM yyyy")
                  : "TBD"}
              </span>
            </div>
            {shipment.shippingLine && (
              <div className="flex justify-between">
                <span className="text-gray-500">Shipping Line</span>
                <span>{shipment.shippingLine}</span>
              </div>
            )}
            {shipment.vesselName && (
              <div className="flex justify-between">
                <span className="text-gray-500">Vessel</span>
                <span>{shipment.vesselName}</span>
              </div>
            )}
            {shipment.containerNumber && (
              <div className="flex justify-between">
                <span className="text-gray-500">Container #</span>
                <span className="font-mono">{shipment.containerNumber}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Document Checklist */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Document Checklist</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(
              ["BL", "COMMERCIAL_INVOICE", "PACKING_LIST", "K1"] as const
            ).map((type) => {
              const uploaded = docTypes.includes(type);
              return (
                <div
                  key={type}
                  className="flex items-center justify-between text-sm"
                >
                  <span>{DOCUMENT_TYPE_LABELS[type]}</span>
                  <Badge
                    variant={uploaded ? "default" : "secondary"}
                    className={
                      uploaded
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-500"
                    }
                  >
                    {uploaded ? "✓ Uploaded" : "Missing"}
                  </Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Payment Status */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Payment Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {shipment.purchaseOrder.payments.map((pmt) => (
              <div key={pmt.id} className="flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium">{pmt.type}</span>
                  <span className="text-gray-500 ml-2">
                    {shipment.purchaseOrder.currency} {pmt.amount.toFixed(2)}
                  </span>
                </div>
                <Badge className={PAYMENT_STATUS_COLORS[pmt.status]}>
                  {PAYMENT_STATUS_LABELS[pmt.status]}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Documents List */}
      {shipment.documents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Uploaded Documents</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {shipment.documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary">
                      {DOCUMENT_TYPE_LABELS[doc.type] || doc.type}
                    </Badge>
                    <div>
                      <div className="text-sm font-medium">{doc.fileName}</div>
                      <div className="text-xs text-gray-400">
                        {(doc.fileSize / 1024).toFixed(1)} KB - Uploaded by{" "}
                        {doc.uploadedBy.name} on{" "}
                        {format(new Date(doc.createdAt), "dd MMM yyyy")}
                      </div>
                      {doc.notes && (
                        <div className="text-xs text-gray-500 mt-1">
                          {doc.notes}
                        </div>
                      )}
                    </div>
                  </div>
                  <a
                    href={`/api/documents/${doc.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button variant="outline" size="sm">
                      Download
                    </Button>
                  </a>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ETA Update History */}
      {shipment.etaUpdates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>ETA Change History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {shipment.etaUpdates.map((update) => (
                <div
                  key={update.id}
                  className="flex items-start gap-3 text-sm border-l-2 border-blue-200 pl-4"
                >
                  <div className="flex-1">
                    <div>
                      {update.previousEta && (
                        <span className="text-gray-400 line-through mr-2">
                          {format(new Date(update.previousEta), "dd MMM yyyy")}
                        </span>
                      )}
                      <span className="font-medium">
                        → {format(new Date(update.newEta), "dd MMM yyyy")}
                      </span>
                    </div>
                    {update.reason && (
                      <p className="text-gray-500 text-xs mt-1">
                        {update.reason}
                      </p>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 text-right">
                    <div>{update.updatedBy.name}</div>
                    <div>
                      {format(new Date(update.createdAt), "dd MMM HH:mm")}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Line Items */}
      <Card>
        <CardHeader>
          <CardTitle>PO Line Items</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left">
                  <th className="p-3 font-medium">Seller SKU</th>
                  <th className="p-3 font-medium">Product</th>
                  <th className="p-3 font-medium text-right">Qty</th>
                  <th className="p-3 font-medium text-right">Unit Cost</th>
                  <th className="p-3 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {shipment.purchaseOrder.lineItems.map((li) => (
                  <tr key={li.id} className="border-b">
                    <td className="p-3 font-mono text-xs">
                      {li.product.sellerSku || "-"}
                    </td>
                    <td className="p-3">{li.product.name}</td>
                    <td className="p-3 text-right">
                      {li.quantity.toLocaleString()}
                    </td>
                    <td className="p-3 text-right">
                      {shipment.purchaseOrder.currency} {li.unitCost.toFixed(2)}
                    </td>
                    <td className="p-3 text-right font-medium">
                      {shipment.purchaseOrder.currency} {li.totalCost.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ETA Update Sheet */}
      <Sheet open={showEtaForm} onOpenChange={setShowEtaForm}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Update ETA</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            {shipment.eta && (
              <p className="text-sm text-gray-500">
                Current ETA:{" "}
                {format(new Date(shipment.eta), "dd MMM yyyy")}
              </p>
            )}
            <div className="space-y-2">
              <Label>New ETA</Label>
              <Input
                type="date"
                value={etaForm.newEta}
                onChange={(e) =>
                  setEtaForm({ ...etaForm, newEta: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Reason for change</Label>
              <Textarea
                value={etaForm.reason}
                onChange={(e) =>
                  setEtaForm({ ...etaForm, reason: e.target.value })
                }
                placeholder="e.g. Port congestion, weather delay..."
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleEtaUpdate}
                disabled={updatingEta || !etaForm.newEta}
              >
                {updatingEta ? "Updating..." : "Update ETA"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowEtaForm(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Status Update Sheet */}
      <Sheet open={showStatusForm} onOpenChange={setShowStatusForm}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Update Shipment</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div className="space-y-2">
              <Label>Status</Label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={statusForm.status}
                onChange={(e) =>
                  setStatusForm({ ...statusForm, status: e.target.value })
                }
              >
                {STATUS_FLOW.map((s) => (
                  <option key={s} value={s}>
                    {SHIPMENT_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Shipping Line</Label>
              <Input
                value={statusForm.shippingLine}
                onChange={(e) =>
                  setStatusForm({ ...statusForm, shippingLine: e.target.value })
                }
                placeholder="e.g. COSCO, Evergreen"
              />
            </div>
            <div className="space-y-2">
              <Label>Vessel Name</Label>
              <Input
                value={statusForm.vesselName}
                onChange={(e) =>
                  setStatusForm({ ...statusForm, vesselName: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Container Number</Label>
              <Input
                value={statusForm.containerNumber}
                onChange={(e) =>
                  setStatusForm({
                    ...statusForm,
                    containerNumber: e.target.value,
                  })
                }
                placeholder="e.g. CSQU1234567"
              />
            </div>
            {isAdmin && logisticsPartners.length > 0 && (
              <div className="space-y-2">
                <Label>Assign Logistics Partner</Label>
                <select
                  className="w-full border rounded-md px-3 py-2 text-sm"
                  value={statusForm.logisticsUserId}
                  onChange={(e) =>
                    setStatusForm({ ...statusForm, logisticsUserId: e.target.value })
                  }
                >
                  <option value="">Select freight partner...</option>
                  {logisticsPartners.map((lp) => (
                    <option key={lp.id} value={lp.id}>
                      {lp.companyName || lp.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={statusForm.notes}
                onChange={(e) =>
                  setStatusForm({ ...statusForm, notes: e.target.value })
                }
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleStatusUpdate}
                disabled={updatingStatus}
              >
                {updatingStatus ? "Updating..." : "Update"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowStatusForm(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Document Upload Sheet */}
      <Sheet open={showDocForm} onOpenChange={setShowDocForm}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Upload Document</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div className="space-y-2">
              <Label>Document Type</Label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
              >
                <option value="BL">Bill of Lading</option>
                <option value="COMMERCIAL_INVOICE">Commercial Invoice</option>
                <option value="PACKING_LIST">Packing List</option>
                {isAdmin && <option value="K1">K1 (Customs Form)</option>}
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>File</Label>
              <Input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                onChange={(e) => setDocFile(e.target.files?.[0] || null)}
              />
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea
                value={docNotes}
                onChange={(e) => setDocNotes(e.target.value)}
                placeholder="Any notes about this document..."
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleDocUpload}
                disabled={uploading || !docFile}
              >
                {uploading ? "Uploading..." : "Upload"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowDocForm(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
