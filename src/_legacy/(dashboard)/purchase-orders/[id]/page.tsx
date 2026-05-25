"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  PO_STATUS_LABELS,
  PO_STATUS_COLORS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_COLORS,
  DOCUMENT_TYPE_LABELS,
} from "@/lib/constants";
import { format } from "date-fns";

type PODetail = {
  id: string;
  poNumber: string;
  status: string;
  containerType: string | null;
  totalWeight: number;
  totalVolume: number;
  totalAmount: number;
  depositPercent: number;
  depositAmount: number;
  balanceDueDays: number;
  currency: string;
  notes: string | null;
  supplierInvoiceNo: string | null;
  requestedEta: string | null;
  confirmedAt: string | null;
  createdAt: string;
  supplier: {
    id: string;
    name: string;
    companyName: string | null;
    email: string;
    phone: string | null;
  };
  createdBy: { id: string; name: string };
  lineItems: {
    id: string;
    quantity: number;
    unitCost: number;
    totalCost: number;
    weightSubtotal: number;
    volumeSubtotal: number;
    suggestedQty: number | null;
    batchNumber: string | null;
    product: {
      id: string;
      sku: string;
      sellerSku: string | null;
      barcode: string | null;
      name: string;
    };
  }[];
  shipment: {
    id: string;
    status: string;
    eta: string | null;
    etd: string | null;
    portOfOrigin: string | null;
    portOfDest: string;
    documents: { id: string; type: string; fileName: string; createdAt: string }[];
    etaUpdates: { id: string; previousEta: string | null; newEta: string; reason: string | null; createdAt: string }[];
  } | null;
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

const STATUS_FLOW = [
  "DRAFT",
  "PENDING_SUPPLIER",
  "CONFIRMED",
  "IN_TRANSIT",
  "CUSTOMS",
  "RECEIVED",
  "COMPLETED",
];

export default function PODetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const user = session?.user as any;
  const isAdmin = user?.role === "ADMIN";

  const [po, setPO] = useState<PODetail | null>(null);
  const [loading, setLoading] = useState(true);
  const isSupplier = user?.role === "SUPPLIER";

  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmForm, setConfirmForm] = useState({
    eta: "",
    etd: "",
    portOfOrigin: "Qingdao",
    portOfDest: "Port Klang",
  });
  const [confirming, setConfirming] = useState(false);

  // Send to supplier
  const [showSendToSupplier, setShowSendToSupplier] = useState(false);
  const [requestedEta, setRequestedEta] = useState("");
  const [sending, setSending] = useState(false);

  // Supplier response
  const [showSupplierResponse, setShowSupplierResponse] = useState(false);
  const [supplierAction, setSupplierAction] = useState<"APPROVE" | "REJECT">("APPROVE");
  const [supplierNotes, setSupplierNotes] = useState("");
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState("");
  const [confirmedEta, setConfirmedEta] = useState("");
  const [responding, setResponding] = useState(false);

  // Logistics partners
  const [logisticsPartners, setLogisticsPartners] = useState<{ id: string; name: string; companyName: string | null }[]>([]);
  const [selectedLogisticsId, setSelectedLogisticsId] = useState("");

  // Batch numbers
  const [showBatchForm, setShowBatchForm] = useState(false);
  const [batchNumbers, setBatchNumbers] = useState<Record<string, string>>({});
  const [savingBatch, setSavingBatch] = useState(false);

  async function loadPO() {
    const res = await fetch(`/api/purchase-orders/${params.id}`);
    if (res.ok) setPO(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    loadPO();
    if (isAdmin) {
      fetch("/api/logistics-partners")
        .then((r) => r.json())
        .then(setLogisticsPartners)
        .catch(() => {});
    }
  }, [params.id]);

  async function handleConfirm() {
    setConfirming(true);
    const res = await fetch(`/api/purchase-orders/${params.id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...confirmForm, logisticsUserId: selectedLogisticsId || null }),
    });
    if (res.ok) {
      setShowConfirm(false);
      loadPO();
    }
    setConfirming(false);
  }

  async function handleExport() {
    window.open(`/api/purchase-orders/${params.id}/export`, "_blank");
  }

  async function handleSendToSupplier() {
    setSending(true);
    await fetch(`/api/purchase-orders/${params.id}/send-to-supplier`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestedEta: requestedEta || null }),
    });
    setShowSendToSupplier(false);
    setSending(false);
    loadPO();
  }

  async function handleSupplierResponse() {
    setResponding(true);
    await fetch(`/api/purchase-orders/${params.id}/supplier-response`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: supplierAction,
        supplierNotes: supplierNotes || null,
        supplierInvoiceNo: supplierInvoiceNo || null,
        confirmedEta: confirmedEta || null,
      }),
    });
    setShowSupplierResponse(false);
    setResponding(false);
    loadPO();
  }

  async function handleSaveBatchNumbers() {
    setSavingBatch(true);
    const lineItems = Object.entries(batchNumbers)
      .filter(([, v]) => v)
      .map(([lineItemId, batchNumber]) => ({ lineItemId, batchNumber }));
    if (lineItems.length > 0) {
      await fetch(`/api/purchase-orders/${params.id}/batch-numbers`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineItems }),
      });
    }
    setShowBatchForm(false);
    setSavingBatch(false);
    loadPO();
  }

  if (loading) return <p className="p-6 text-gray-500">Loading...</p>;
  if (!po) return <p className="p-6 text-gray-500">PO not found</p>;

  const currentStatusIdx = STATUS_FLOW.indexOf(po.status);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold font-mono">{po.poNumber}</h1>
            <Badge className={PO_STATUS_COLORS[po.status]}>
              {PO_STATUS_LABELS[po.status]}
            </Badge>
          </div>
          <p className="text-sm text-gray-500">
            Created by {po.createdBy.name} on{" "}
            {format(new Date(po.createdAt), "dd MMM yyyy")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport}>
            Export Excel
          </Button>
          {isAdmin && po.status === "DRAFT" && (
            <Button onClick={() => setShowSendToSupplier(true)}>
              Send to Supplier
            </Button>
          )}
          {isAdmin && po.status === "DRAFT" && (
            <Button variant="outline" onClick={() => setShowConfirm(true)}>
              Direct Confirm
            </Button>
          )}
          {isSupplier && po.status === "PENDING_SUPPLIER" && (
            <>
              <Button
                onClick={() => { setSupplierAction("APPROVE"); setShowSupplierResponse(true); }}
              >
                Approve PO
              </Button>
              <Button
                variant="destructive"
                onClick={() => { setSupplierAction("REJECT"); setShowSupplierResponse(true); }}
              >
                Reject
              </Button>
            </>
          )}
          {(isSupplier || isAdmin) && ["CONFIRMED", "IN_TRANSIT"].includes(po.status) && (
            <Button
              variant="outline"
              onClick={() => {
                const batches: Record<string, string> = {};
                po.lineItems.forEach((li) => { batches[li.id] = li.batchNumber || ""; });
                setBatchNumbers(batches);
                setShowBatchForm(true);
              }}
            >
              {isSupplier ? "Enter Batch Numbers" : "View Batch Numbers"}
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
              const isCurrent = status === po.status;
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
                      className={`text-xs mt-1 ${
                        isCurrent ? "font-medium" : "text-gray-400"
                      }`}
                    >
                      {PO_STATUS_LABELS[status]}
                    </span>
                  </div>
                  {i < STATUS_FLOW.length - 1 && (
                    <div
                      className={`flex-1 h-0.5 mx-2 ${
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
        {/* Supplier Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Supplier</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <p className="font-medium">
              {po.supplier.companyName || po.supplier.name}
            </p>
            <p className="text-gray-500">{po.supplier.email}</p>
            {po.supplier.phone && (
              <p className="text-gray-500">{po.supplier.phone}</p>
            )}
          </CardContent>
        </Card>

        {/* Shipping Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Shipping</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <p>Container: {po.containerType || "TBD"}</p>
            <p>Weight: {po.totalWeight.toFixed(1)} kg</p>
            <p>Volume: {po.totalVolume.toFixed(4)} CBM</p>
            {po.shipment?.eta && (
              <p>
                ETA: {format(new Date(po.shipment.eta), "dd MMM yyyy")}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Payment Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Payment Terms</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <p className="font-medium">
              Total: {po.currency}{" "}
              {po.totalAmount.toLocaleString("en-MY", {
                minimumFractionDigits: 2,
              })}
            </p>
            <p>
              Deposit: {po.depositPercent}% ({po.currency}{" "}
              {po.depositAmount.toFixed(2)})
            </p>
            <p>Balance due: {po.balanceDueDays} days after ETA</p>
          </CardContent>
        </Card>
      </div>

      {/* Line Items */}
      <Card>
        <CardHeader>
          <CardTitle>Line Items ({po.lineItems.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left">
                  <th className="p-3 font-medium">#</th>
                  <th className="p-3 font-medium">Seller SKU</th>
                  <th className="p-3 font-medium">Product</th>
                  <th className="p-3 font-medium text-right">Qty</th>
                  <th className="p-3 font-medium text-right">Unit Cost</th>
                  <th className="p-3 font-medium text-right">Total</th>
                  <th className="p-3 font-medium text-right">Weight</th>
                  <th className="p-3 font-medium text-right">Volume</th>
                </tr>
              </thead>
              <tbody>
                {po.lineItems.map((li, i) => (
                  <tr key={li.id} className="border-b">
                    <td className="p-3 text-gray-400">{i + 1}</td>
                    <td className="p-3 font-mono text-xs">
                      {li.product.sellerSku || "-"}
                    </td>
                    <td className="p-3">
                      <div>{li.product.name}</div>
                      <div className="text-xs text-gray-400">
                        {li.product.sku}
                      </div>
                    </td>
                    <td className="p-3 text-right font-medium">
                      {li.quantity.toLocaleString()}
                    </td>
                    <td className="p-3 text-right">
                      {po.currency} {li.unitCost.toFixed(2)}
                    </td>
                    <td className="p-3 text-right font-medium">
                      {po.currency} {li.totalCost.toFixed(2)}
                    </td>
                    <td className="p-3 font-mono text-xs text-gray-500">
                      {li.batchNumber || "-"}
                    </td>
                    <td className="p-3 text-right text-gray-500">
                      {li.weightSubtotal.toFixed(1)} kg
                    </td>
                    <td className="p-3 text-right text-gray-500">
                      {li.volumeSubtotal.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Payments */}
      {po.payments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Payment Schedule</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left">
                    <th className="p-3 font-medium">Type</th>
                    <th className="p-3 font-medium text-right">Amount</th>
                    <th className="p-3 font-medium">Due Date</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium">Paid Date</th>
                    <th className="p-3 font-medium">Slips</th>
                  </tr>
                </thead>
                <tbody>
                  {po.payments.map((pmt) => (
                    <tr key={pmt.id} className="border-b">
                      <td className="p-3 font-medium">{pmt.type}</td>
                      <td className="p-3 text-right font-medium">
                        {po.currency} {pmt.amount.toFixed(2)}
                      </td>
                      <td className="p-3">
                        {format(new Date(pmt.dueDate), "dd MMM yyyy")}
                      </td>
                      <td className="p-3">
                        <Badge
                          className={PAYMENT_STATUS_COLORS[pmt.status]}
                        >
                          {PAYMENT_STATUS_LABELS[pmt.status]}
                        </Badge>
                      </td>
                      <td className="p-3 text-gray-500">
                        {pmt.paidDate
                          ? format(new Date(pmt.paidDate), "dd MMM yyyy")
                          : "-"}
                      </td>
                      <td className="p-3 text-gray-500">
                        {pmt._count.paymentSlips} uploaded
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Documents */}
      {po.shipment?.documents && po.shipment.documents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Shipment Documents</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {po.shipment.documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div>
                    <Badge variant="secondary">
                      {DOCUMENT_TYPE_LABELS[doc.type] || doc.type}
                    </Badge>
                    <span className="ml-2 text-sm">{doc.fileName}</span>
                  </div>
                  <span className="text-xs text-gray-400">
                    {format(new Date(doc.createdAt), "dd MMM yyyy")}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Send to Supplier Sheet */}
      <Sheet open={showSendToSupplier} onOpenChange={setShowSendToSupplier}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Send PO to Supplier</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <p className="text-sm text-gray-500">
              This will send the PO to the supplier for review and approval.
            </p>
            <div className="space-y-2">
              <Label>Requested ETA (optional)</Label>
              <Input type="date" value={requestedEta} onChange={(e) => setRequestedEta(e.target.value)} />
              <p className="text-xs text-gray-400">The date you need the goods to arrive</p>
            </div>
            <div className="flex gap-2 pt-4">
              <Button onClick={handleSendToSupplier} disabled={sending}>
                {sending ? "Sending..." : "Send to Supplier"}
              </Button>
              <Button variant="outline" onClick={() => setShowSendToSupplier(false)}>Cancel</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Supplier Response Sheet */}
      <Sheet open={showSupplierResponse} onOpenChange={setShowSupplierResponse}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{supplierAction === "APPROVE" ? "Approve Purchase Order" : "Reject Purchase Order"}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            {supplierAction === "APPROVE" && (
              <>
                <div className="space-y-2">
                  <Label>Your Invoice / Proforma Number</Label>
                  <Input value={supplierInvoiceNo} onChange={(e) => setSupplierInvoiceNo(e.target.value)} placeholder="e.g. JZY260415A" />
                </div>
                <div className="space-y-2">
                  <Label>Confirmed ETA</Label>
                  <Input type="date" value={confirmedEta} onChange={(e) => setConfirmedEta(e.target.value)} />
                  {po.requestedEta && (
                    <p className="text-xs text-gray-400">Requested: {format(new Date(po.requestedEta), "dd MMM yyyy")}</p>
                  )}
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label>Notes</Label>
              <Input value={supplierNotes} onChange={(e) => setSupplierNotes(e.target.value)} placeholder={supplierAction === "REJECT" ? "Reason for rejection..." : "Any notes..."} />
            </div>
            <div className="flex gap-2 pt-4">
              <Button onClick={handleSupplierResponse} disabled={responding} variant={supplierAction === "REJECT" ? "destructive" : "default"}>
                {responding ? "Processing..." : supplierAction === "APPROVE" ? "Approve & Confirm" : "Reject PO"}
              </Button>
              <Button variant="outline" onClick={() => setShowSupplierResponse(false)}>Cancel</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Batch Numbers Sheet */}
      <Sheet open={showBatchForm} onOpenChange={setShowBatchForm}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Batch Numbers</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            {po.lineItems.map((li) => (
              <div key={li.id} className="space-y-1">
                <Label className="text-xs">{li.product.name}</Label>
                <Input
                  value={batchNumbers[li.id] || ""}
                  onChange={(e) => setBatchNumbers({ ...batchNumbers, [li.id]: e.target.value })}
                  placeholder="Enter batch number..."
                  disabled={!isSupplier && !isAdmin}
                />
              </div>
            ))}
            {(isSupplier || isAdmin) && (
              <div className="flex gap-2 pt-4">
                <Button onClick={handleSaveBatchNumbers} disabled={savingBatch}>
                  {savingBatch ? "Saving..." : "Save Batch Numbers"}
                </Button>
                <Button variant="outline" onClick={() => setShowBatchForm(false)}>Cancel</Button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Confirm Sheet */}
      <Sheet open={showConfirm} onOpenChange={setShowConfirm}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Confirm Purchase Order</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <p className="text-sm text-gray-500">
              Confirming this PO will create a shipment record and payment
              schedule.
            </p>
            <div className="space-y-2">
              <Label>Estimated Departure (ETD)</Label>
              <Input
                type="date"
                value={confirmForm.etd}
                onChange={(e) =>
                  setConfirmForm({ ...confirmForm, etd: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Estimated Arrival (ETA)</Label>
              <Input
                type="date"
                value={confirmForm.eta}
                onChange={(e) =>
                  setConfirmForm({ ...confirmForm, eta: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Port of Origin</Label>
              <Input
                value={confirmForm.portOfOrigin}
                onChange={(e) =>
                  setConfirmForm({
                    ...confirmForm,
                    portOfOrigin: e.target.value,
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Port of Destination</Label>
              <Input
                value={confirmForm.portOfDest}
                onChange={(e) =>
                  setConfirmForm({
                    ...confirmForm,
                    portOfDest: e.target.value,
                  })
                }
              />
            </div>
            {logisticsPartners.length > 0 && (
              <div className="space-y-2">
                <Label>Assign Logistics Partner</Label>
                <select
                  className="w-full border rounded-md px-3 py-2 text-sm"
                  value={selectedLogisticsId}
                  onChange={(e) => setSelectedLogisticsId(e.target.value)}
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
            <div className="flex gap-2 pt-4">
              <Button onClick={handleConfirm} disabled={confirming}>
                {confirming ? "Confirming..." : "Confirm PO"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowConfirm(false)}
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
