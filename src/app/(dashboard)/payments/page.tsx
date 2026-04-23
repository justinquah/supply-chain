"use client";

import { useEffect, useState } from "react";
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
import { PAYMENT_STATUS_LABELS, PAYMENT_STATUS_COLORS } from "@/lib/constants";
import { format } from "date-fns";

type Payment = {
  id: string;
  payee: string;
  payeeUserId: string | null;
  type: string;
  description: string | null;
  amount: number;
  currency: string;
  dueDate: string;
  status: string;
  paidDate: string | null;
  invoiceRef: string | null;
  notes: string | null;
  isOverdue: boolean;
  purchaseOrder: {
    id: string;
    poNumber: string;
    currency: string;
    supplier: { id: string; name: string; companyName: string | null };
    shipment: { eta: string | null; status: string } | null;
  };
  _count: { paymentSlips: number };
};

type Supplier = { id: string; name: string; companyName: string | null };

const payeeLabels: Record<string, string> = {
  SUPPLIER: "Supplier (COGS)",
  LOGISTICS: "Logistics Fees",
};

const typeLabels: Record<string, string> = {
  DEPOSIT: "Deposit",
  BALANCE: "Balance",
  LOCAL_FEES: "Local Fees",
  SST: "SST",
  CUSTOMS: "Customs Clearance",
  TRANSPORT: "Local Transport",
  OTHER: "Other",
};

export default function PaymentsPage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const isAdmin = user?.role === "ADMIN";
  const isFinance = user?.role === "FINANCE";
  const canManage = isAdmin || isFinance;

  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterPayee, setFilterPayee] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  // Add logistics fee form
  const [showAddFee, setShowAddFee] = useState(false);
  const [feeForm, setFeeForm] = useState({
    purchaseOrderId: "",
    type: "LOCAL_FEES",
    description: "",
    amount: "",
    dueDate: "",
    invoiceRef: "",
    notes: "",
  });
  const [addingFee, setAddingFee] = useState(false);

  // Payment slip upload
  const [showSlipUpload, setShowSlipUpload] = useState(false);
  const [selectedPaymentId, setSelectedPaymentId] = useState("");
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipNotes, setSlipNotes] = useState("");
  const [uploadingSlip, setUploadingSlip] = useState(false);

  // PO list for logistics fee form
  const [pos, setPOs] = useState<{ id: string; poNumber: string }[]>([]);

  async function loadPayments() {
    const params = new URLSearchParams();
    if (filterPayee) params.set("payee", filterPayee);
    if (filterStatus) params.set("status", filterStatus);
    const res = await fetch(`/api/payments?${params}`);
    if (res.ok) setPayments(await res.json());
    setLoading(false);
  }

  async function loadPOs() {
    const res = await fetch("/api/purchase-orders");
    if (res.ok) {
      const data = await res.json();
      setPOs(
        data.map((p: any) => ({ id: p.id, poNumber: p.poNumber }))
      );
    }
  }

  useEffect(() => {
    loadPayments();
    if (isAdmin) loadPOs();
  }, [filterPayee, filterStatus]);

  async function markAsPaid(paymentId: string) {
    await fetch(`/api/payments/${paymentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "PAID" }),
    });
    loadPayments();
  }

  async function handleAddFee() {
    setAddingFee(true);
    await fetch("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(feeForm),
    });
    setShowAddFee(false);
    setAddingFee(false);
    setFeeForm({
      purchaseOrderId: "",
      type: "LOCAL_FEES",
      description: "",
      amount: "",
      dueDate: "",
      invoiceRef: "",
      notes: "",
    });
    loadPayments();
  }

  async function handleSlipUpload() {
    if (!slipFile || !selectedPaymentId) return;
    setUploadingSlip(true);
    const formData = new FormData();
    formData.append("file", slipFile);
    if (slipNotes) formData.append("notes", slipNotes);
    await fetch(`/api/payments/${selectedPaymentId}/slips`, {
      method: "POST",
      body: formData,
    });
    setShowSlipUpload(false);
    setSlipFile(null);
    setSlipNotes("");
    setUploadingSlip(false);
    loadPayments();
  }

  function openSlipUpload(paymentId: string) {
    setSelectedPaymentId(paymentId);
    setShowSlipUpload(true);
  }

  // Summary calculations
  const supplierPending = payments
    .filter((p) => p.payee === "SUPPLIER" && p.status === "PENDING")
    .reduce((s, p) => s + p.amount, 0);
  const logisticsPending = payments
    .filter((p) => p.payee === "LOGISTICS" && p.status === "PENDING")
    .reduce((s, p) => s + p.amount, 0);
  const overdue = payments.filter((p) => p.isOverdue);
  const overdueTotal = overdue.reduce((s, p) => s + p.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Payments</h1>
          <p className="text-sm text-gray-500">
            Track supplier COGS and logistics fee payments
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setShowAddFee(true)}>
            Add Logistics Fee
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      {canManage && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-sm text-gray-500">Supplier Payments Due</div>
              <div className="text-2xl font-bold">
                {payments.length > 0 ? payments[0]?.purchaseOrder?.currency || "RM" : "RM"}{" "}
                {supplierPending.toLocaleString("en-MY", {
                  minimumFractionDigits: 2,
                })}
              </div>
              <div className="text-xs text-gray-400">
                COGS deposits + balances pending
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-sm text-gray-500">Logistics Fees Due</div>
              <div className="text-2xl font-bold">
                RM{" "}
                {logisticsPending.toLocaleString("en-MY", {
                  minimumFractionDigits: 2,
                })}
              </div>
              <div className="text-xs text-gray-400">
                Local fees, SST, customs, transport
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-sm text-red-600">Overdue</div>
              <div className="text-2xl font-bold text-red-600">
                {overdue.length} payments
              </div>
              <div className="text-xs text-gray-400">
                Past due date, action required
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <Button
          variant={filterPayee === "" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilterPayee("")}
        >
          All Payments
        </Button>
        <Button
          variant={filterPayee === "SUPPLIER" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilterPayee("SUPPLIER")}
        >
          Supplier (COGS)
        </Button>
        <Button
          variant={filterPayee === "LOGISTICS" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilterPayee("LOGISTICS")}
        >
          Logistics Fees
        </Button>
        <div className="w-px bg-gray-300 mx-1" />
        <Button
          variant={filterStatus === "" ? "secondary" : "outline"}
          size="sm"
          onClick={() => setFilterStatus("")}
        >
          All Status
        </Button>
        <Button
          variant={filterStatus === "PENDING" ? "secondary" : "outline"}
          size="sm"
          onClick={() => setFilterStatus("PENDING")}
        >
          Pending
        </Button>
        <Button
          variant={filterStatus === "PAID" ? "secondary" : "outline"}
          size="sm"
          onClick={() => setFilterStatus("PAID")}
        >
          Paid
        </Button>
      </div>

      {/* Payments Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-sm text-gray-500">Loading...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left">
                    <th className="p-3 font-medium">PO</th>
                    <th className="p-3 font-medium">Pay To</th>
                    <th className="p-3 font-medium">Type</th>
                    <th className="p-3 font-medium">Description</th>
                    <th className="p-3 font-medium text-right">Amount</th>
                    <th className="p-3 font-medium">Due Date</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium">Slips</th>
                    {canManage && (
                      <th className="p-3 font-medium">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {payments.map((pmt) => (
                    <tr
                      key={pmt.id}
                      className={`border-b hover:bg-gray-50 ${
                        pmt.isOverdue ? "bg-red-50" : ""
                      }`}
                    >
                      <td className="p-3 font-mono text-xs">
                        {pmt.purchaseOrder.poNumber}
                      </td>
                      <td className="p-3">
                        <Badge
                          variant="secondary"
                          className={
                            pmt.payee === "SUPPLIER"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-purple-100 text-purple-700"
                          }
                        >
                          {pmt.payee === "SUPPLIER" ? "Supplier" : "Logistics"}
                        </Badge>
                      </td>
                      <td className="p-3">{typeLabels[pmt.type] || pmt.type}</td>
                      <td className="p-3 text-gray-500 text-xs max-w-48 truncate">
                        {pmt.description || "-"}
                        {pmt.invoiceRef && (
                          <div className="text-xs text-gray-400">
                            Ref: {pmt.invoiceRef}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-right font-medium">
                        {pmt.currency}{" "}
                        {pmt.amount.toLocaleString("en-MY", {
                          minimumFractionDigits: 2,
                        })}
                      </td>
                      <td className="p-3">
                        <span
                          className={
                            pmt.isOverdue ? "text-red-600 font-medium" : ""
                          }
                        >
                          {format(new Date(pmt.dueDate), "dd MMM yyyy")}
                        </span>
                        {pmt.isOverdue && (
                          <div className="text-xs text-red-500">OVERDUE</div>
                        )}
                      </td>
                      <td className="p-3">
                        <Badge className={PAYMENT_STATUS_COLORS[pmt.status]}>
                          {PAYMENT_STATUS_LABELS[pmt.status]}
                        </Badge>
                        {pmt.paidDate && (
                          <div className="text-xs text-gray-400">
                            {format(new Date(pmt.paidDate), "dd MMM")}
                          </div>
                        )}
                      </td>
                      <td className="p-3">
                        <span className="text-gray-500">
                          {pmt._count.paymentSlips}
                        </span>
                      </td>
                      {canManage && (
                        <td className="p-3 space-x-1">
                          {pmt.status === "PENDING" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => markAsPaid(pmt.id)}
                            >
                              Mark Paid
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openSlipUpload(pmt.id)}
                          >
                            Upload Slip
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {payments.length === 0 && (
                    <tr>
                      <td
                        colSpan={canManage ? 9 : 8}
                        className="p-6 text-center text-gray-500"
                      >
                        No payments found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Logistics Fee Sheet */}
      <Sheet open={showAddFee} onOpenChange={setShowAddFee}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Add Logistics Fee</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div className="space-y-2">
              <Label>Purchase Order</Label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={feeForm.purchaseOrderId}
                onChange={(e) =>
                  setFeeForm({ ...feeForm, purchaseOrderId: e.target.value })
                }
              >
                <option value="">Select PO...</option>
                {pos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.poNumber}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Fee Type</Label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={feeForm.type}
                onChange={(e) =>
                  setFeeForm({ ...feeForm, type: e.target.value })
                }
              >
                <option value="LOCAL_FEES">Local Fees</option>
                <option value="SST">SST</option>
                <option value="CUSTOMS">Customs Clearance</option>
                <option value="TRANSPORT">Local Transport</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                value={feeForm.description}
                onChange={(e) =>
                  setFeeForm({ ...feeForm, description: e.target.value })
                }
                placeholder="e.g. Customs clearance + port charges"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Amount (RM)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={feeForm.amount}
                  onChange={(e) =>
                    setFeeForm({ ...feeForm, amount: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input
                  type="date"
                  value={feeForm.dueDate}
                  onChange={(e) =>
                    setFeeForm({ ...feeForm, dueDate: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Invoice Reference</Label>
              <Input
                value={feeForm.invoiceRef}
                onChange={(e) =>
                  setFeeForm({ ...feeForm, invoiceRef: e.target.value })
                }
                placeholder="Logistics invoice number"
              />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={feeForm.notes}
                onChange={(e) =>
                  setFeeForm({ ...feeForm, notes: e.target.value })
                }
              />
            </div>
            <div className="flex gap-2 pt-4">
              <Button
                onClick={handleAddFee}
                disabled={
                  addingFee || !feeForm.purchaseOrderId || !feeForm.amount
                }
              >
                {addingFee ? "Adding..." : "Add Fee"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowAddFee(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Payment Slip Upload Sheet */}
      <Sheet open={showSlipUpload} onOpenChange={setShowSlipUpload}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Upload Payment Slip</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <p className="text-sm text-gray-500">
              Upload proof of payment (bank transfer receipt, etc.)
            </p>
            <div className="space-y-2">
              <Label>Payment Slip File</Label>
              <Input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => setSlipFile(e.target.files?.[0] || null)}
              />
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea
                value={slipNotes}
                onChange={(e) => setSlipNotes(e.target.value)}
                placeholder="e.g. TT reference number, bank details..."
              />
            </div>
            <div className="flex gap-2 pt-4">
              <Button
                onClick={handleSlipUpload}
                disabled={uploadingSlip || !slipFile}
              >
                {uploadingSlip ? "Uploading..." : "Upload Slip"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowSlipUpload(false)}
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
