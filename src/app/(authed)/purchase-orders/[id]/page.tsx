import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocBadges } from "../doc-badge";
import { Stepper } from "./stepper";
import { StageForms } from "./stage-forms";
import { ReceiptProofLink } from "./receipt-proof-link";
import {
  PO_WORKFLOW_COLORS,
  PO_WORKFLOW_LABELS,
  canActOnState,
  waitingOnLabel,
} from "@/lib/po-workflow";

function money(n: number | null | undefined, cur: string | null | undefined) {
  if (n == null) return "—";
  return `${cur || "MYR"} ${Number(n).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function date(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-MY", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function dateTime(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-MY", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kuala_Lumpur",
  });
}

// Unload duration = unload_completed_at - container_arrived_at (00:00 KL on the arrival date).
function unloadDuration(
  arrivedAt: string | null | undefined,
  unloadCompletedAt: string | null | undefined
): string | null {
  if (!arrivedAt || !unloadCompletedAt) return null;
  const arrivedMs = new Date(`${arrivedAt}T00:00:00+08:00`).getTime();
  const completedMs = new Date(unloadCompletedAt).getTime();
  const diffMs = completedMs - arrivedMs;
  if (Number.isNaN(diffMs)) return null;
  const hours = diffMs / (1000 * 60 * 60);
  if (hours < 0) return "—";
  const days = Math.floor(hours / 24);
  const remHours = Math.round(hours % 24);
  if (days > 0) return `${days}d ${remHours}h`;
  return `${remHours}h`;
}

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await getCurrentUser();
  const role = profile?.role ?? "";

  const [{ data: po }, { data: bal }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select(
        "id, po_number, status, currency, invoice_currency, product_group, " +
          "expected_invoice_amount, deposit_percent, payment_terms, deposit_due_date, balance_due_date, " +
          "invoice_amount, invoice_number, invoice_date, targeted_eta, actual_eta, notes, created_at, " +
          "container_arrived_at, unload_completed_at, received_qty, damaged_qty, receipt_remark, receipt_proof_path, " +
          "supplier:profiles!supplier_id(name, company_name), " +
          "po_documents(id, doc_type, file_path, file_name, uploaded_at)"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("v_po_balance")
      .select("total_amount, amount_paid, balance_remaining")
      .eq("po_id", id)
      .maybeSingle(),
  ]);

  if (!po) notFound();

  // The joined supplier / po_documents shapes aren't in the generated DB types,
  // so treat the row loosely (consistent with the list page).
  const poRow = po as any;
  const docs = (poRow.po_documents ?? []) as {
    id: string;
    doc_type: string;
    file_path: string;
    file_name: string;
  }[];
  const docTypes = new Set(docs.map((d) => d.doc_type));
  const supplier = poRow.supplier as { name?: string; company_name?: string } | null;
  const cur = poRow.invoice_currency || poRow.currency || "MYR";

  const isActor = canActOnState(role, poRow.status);
  const waitingOn = waitingOnLabel(poRow.status);

  const balanceRemaining = Number(bal?.balance_remaining ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link
            href="/purchase-orders"
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            ← All purchase orders
          </Link>
          <h1 className="text-2xl font-semibold mt-1">
            {poRow.po_number || "Draft PO"}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {supplier?.company_name || supplier?.name || "—"}
            {poRow.product_group ? ` · ${poRow.product_group}` : ""}
          </p>
        </div>
        <span
          className={
            "text-xs px-2.5 py-1 rounded-full font-medium " +
            (PO_WORKFLOW_COLORS[poRow.status] || "bg-gray-100 text-gray-700")
          }
        >
          {PO_WORKFLOW_LABELS[poRow.status] || poRow.status}
        </span>
      </div>

      <Card>
        <CardContent className="py-5">
          <Stepper status={poRow.status} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* PO fields */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <Detail label="Expected invoice amount" value={money(poRow.expected_invoice_amount, cur)} />
            <Detail label="Invoice amount" value={money(poRow.invoice_amount, cur)} />
            <Detail label="Invoice number" value={poRow.invoice_number || "—"} />
            <Detail label="Invoice date" value={date(poRow.invoice_date)} />
            <Detail
              label="Deposit %"
              value={poRow.deposit_percent != null ? `${poRow.deposit_percent}%` : "—"}
            />
            <Detail label="Payment terms" value={poRow.payment_terms || "—"} />
            <Detail label="Deposit due" value={date(poRow.deposit_due_date)} />
            <Detail label="Balance due" value={date(poRow.balance_due_date)} />
            <Detail label="Targeted ETA" value={date(poRow.targeted_eta)} />
            <Detail label="Actual ETA" value={date(poRow.actual_eta)} />
            {poRow.notes && (
              <div className="sm:col-span-2">
                <span className="text-xs text-gray-500 block mb-1">Notes</span>
                <p className="text-gray-700 whitespace-pre-line">{poRow.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Balance */}
        <Card>
          <CardHeader>
            <CardTitle>Balance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Detail label="Total" value={money(bal?.total_amount ?? 0, cur)} />
            <Detail label="Paid" value={money(bal?.amount_paid ?? 0, cur)} />
            <div>
              <span className="text-xs text-gray-500 block mb-1">Remaining</span>
              <span
                className={
                  "text-lg font-semibold tabular-nums " +
                  (balanceRemaining === 0 ? "text-emerald-600" : "text-amber-600")
                }
              >
                {money(balanceRemaining, cur)}
              </span>
            </div>
            <p className="text-xs text-gray-400">
              Paid totals come from Finance-recorded payments (a later increment).
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Documents */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Documents</CardTitle>
          <span className="text-xs text-gray-500">
            Green = uploaded (click to open) · grey = missing
          </span>
        </CardHeader>
        <CardContent>
          <DocBadges docs={docs} />
        </CardContent>
      </Card>

      {/* Goods receipt (WHS-01/02/04) — shown once any receipt data exists */}
      {(poRow.status === "RECEIVED" ||
        poRow.container_arrived_at ||
        poRow.unload_completed_at) && (
        <Card>
          <CardHeader>
            <CardTitle>Goods receipt</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <Detail label="Container arrived" value={date(poRow.container_arrived_at)} />
            <Detail label="Unload completed" value={dateTime(poRow.unload_completed_at)} />
            <Detail
              label="Unload duration"
              value={
                unloadDuration(poRow.container_arrived_at, poRow.unload_completed_at) ?? "—"
              }
            />
            <Detail
              label="Received / damaged qty"
              value={
                poRow.received_qty == null && poRow.damaged_qty == null
                  ? "—"
                  : `${poRow.received_qty ?? "—"} / ${poRow.damaged_qty ?? "0"}`
              }
            />
            {poRow.receipt_remark && (
              <div className="sm:col-span-2">
                <span className="text-xs text-gray-500 block mb-1">Receipt remark</span>
                <p className="text-gray-700 whitespace-pre-line">{poRow.receipt_remark}</p>
              </div>
            )}
            {poRow.receipt_proof_path && (
              <div>
                <span className="text-xs text-gray-500 block mb-1">Proof photo</span>
                <ReceiptProofLink filePath={poRow.receipt_proof_path} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Stage action OR read-only waiting note */}
      <Card>
        <CardHeader>
          <CardTitle>
            {isActor ? "Your action" : "Status"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {poRow.status === "RECEIVED" ? (
            <p className="text-sm text-emerald-700">
              Goods received. This PO has completed its workflow.
            </p>
          ) : poRow.status === "CANCELLED" ? (
            <p className="text-sm text-red-600">This PO was cancelled.</p>
          ) : isActor ? (
            <StageForms
              poId={poRow.id}
              status={poRow.status}
              paymentTerms={poRow.payment_terms}
              balanceRemaining={balanceRemaining}
              hasBl={docTypes.has("BL")}
              hasK1={docTypes.has("K1_FINAL")}
            />
          ) : (
            <p className="text-sm text-gray-600">
              Read-only — waiting on{" "}
              <span className="font-medium text-gray-900">
                {waitingOn || "—"}
              </span>{" "}
              to action this stage.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="text-xs text-gray-500 block mb-1">{label}</span>
      <span className="text-gray-900">{value}</span>
    </div>
  );
}
