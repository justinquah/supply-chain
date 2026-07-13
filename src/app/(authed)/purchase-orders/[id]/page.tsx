import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient, getCurrentUser, requireRole } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocBadges } from "../doc-badge";
import { DocUpload } from "./doc-upload";
import { Stepper } from "./stepper";
import { StageForms } from "./stage-forms";
import { ShipmentForms } from "./shipment-forms";
import { ReceiptProofLink } from "./receipt-proof-link";
import { OceanFreightCell } from "./ocean-freight-cell";
import {
  PO_WORKFLOW_COLORS,
  PO_WORKFLOW_LABELS,
  canActOnState,
  waitingOnLabel,
  currentEtaToPort,
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
  // Internal-only: rejects STAFF and SUPPLIER (suppliers use /supplier).
  await requireRole("SCM", "ADMIN", "ACCOUNTS", "FINANCE", "WAREHOUSE", "LOGISTICS");
  const supabase = await createClient();
  const profile = await getCurrentUser();
  const role = profile?.role ?? "";

  const [
    { data: po },
    { data: bal },
    { data: products },
    { data: incoming },
    { data: fxRows },
  ] =
    await Promise.all([
      supabase
        .from("purchase_orders")
        .select(
          "id, po_number, status, currency, invoice_currency, product_group, supplier_id, " +
            "expected_invoice_amount, deposit_percent, payment_terms, deposit_due_date, balance_due_date, " +
            "invoice_amount, invoice_number, invoice_date, targeted_eta, actual_eta, notes, created_at, " +
            "etd, supplier_eta, logistics_eta, eta_to_warehouse, clearance_status, eta_delayed, delay_reason, " +
            "container_arrived_at, unload_completed_at, received_qty, damaged_qty, receipt_remark, receipt_proof_path, " +
            "ocean_freight_cost, ocean_freight_currency, " +
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
      // Active products for the SHIPPED-stage shipping-lines picker.
      supabase
        .from("products")
        .select("id, sku, name, product_family, variation")
        .eq("is_active", true)
        .order("name"),
      // This PO's shipping lines / incoming stock (shown read-only below +
      // itemised in the receiving form).
      supabase
        .from("incoming_stock")
        .select(
          "id, product_id, quantity, expected_date, status, notes, " +
            "qty_received, qty_damaged, qty_short, qty_extra, " +
            "product:products(sku, name, product_family, variation)"
        )
        .eq("po_id", id)
        .order("expected_date"),
      // FX to MYR for the landed-total conversion.
      supabase.from("fx_rates").select("currency, rate_to_myr"),
    ]);

  if (!po) notFound();

  // currency -> rate_to_myr; missing rate treated as 1 in the landed total.
  const fxMap = new Map<string, number>();
  for (const r of (fxRows ?? []) as any[]) {
    const rate = Number(r.rate_to_myr);
    if (Number.isFinite(rate)) fxMap.set(String(r.currency), rate);
  }
  const fx = (cur: string | null | undefined) => fxMap.get(String(cur)) ?? 1;

  const productOptions = (products ?? []).map((p: any) => ({
    id: p.id,
    label: p.product_family
      ? `${p.product_family}${p.variation ? " — " + p.variation : ""} (${p.sku})`
      : `${p.name} (${p.sku})`,
  }));
  const incomingRows = (incoming ?? []) as any[];

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

  // Per-line PO value = quantity × the (product, supplier) unit cost. Fetched via
  // the admin client so every internal role that can view this PO sees the amounts
  // (LOGISTICS/WAREHOUSE cannot read product_suppliers under RLS). Each PO's lines
  // share one supplier → one cost currency.
  const supplierId = (poRow.supplier_id ?? null) as string | null;
  const lineProductIds = [
    ...new Set(incomingRows.map((r) => String(r.product_id)).filter(Boolean)),
  ];
  const costByProduct = new Map<string, { unitCost: number; currency: string }>();
  if (supplierId && lineProductIds.length > 0) {
    const admin = createAdminClient();
    const { data: costRows } = await admin
      .from("product_suppliers")
      .select("product_id, unit_cost, cost_currency")
      .eq("supplier_id", supplierId)
      .in("product_id", lineProductIds);
    for (const c of (costRows ?? []) as any[]) {
      const unitCost = Number(c.unit_cost);
      if (!Number.isFinite(unitCost)) continue;
      costByProduct.set(String(c.product_id), {
        unitCost,
        currency: String(c.cost_currency),
      });
    }
  }
  let poValueFromLines = 0;
  let lineCurrency: string | null = null;
  for (const row of incomingRows) {
    const cost = costByProduct.get(String(row.product_id));
    if (!cost) continue;
    const qty = Number(row.quantity);
    if (!Number.isFinite(qty)) continue;
    poValueFromLines += qty * cost.unitCost;
    if (!lineCurrency) lineCurrency = cost.currency;
  }
  const hasLineValue = poValueFromLines > 0;

  // Internal roles that handle PO paperwork may upload documents at any stage.
  const canUploadDoc = ["SCM", "ADMIN", "ACCOUNTS", "FINANCE", "LOGISTICS"].includes(role);

  const isActor = canActOnState(role, poRow.status);
  const waitingOn = waitingOnLabel(poRow.status);

  const balanceRemaining = Number(bal?.balance_remaining ?? 0);

  // Who-edits-what matrix for the Shipment & ETA card (see actions.ts).
  const isScmAdmin = role === "SCM" || role === "ADMIN";
  const isLogistics = role === "LOGISTICS" || isScmAdmin;
  const shipmentCaps = {
    canEtd: isScmAdmin,
    canTargeted: isScmAdmin,
    canSupplierEta: false, // supplier edits via portal; read-only here
    canLogistics: isLogistics,
    canWarehouseEta: isLogistics,
    canClearance: isLogistics,
    canActual: isLogistics,
    canDelay: isLogistics,
  };
  const shipmentData = {
    poId: poRow.id as string,
    etd: (poRow.etd ?? null) as string | null,
    targeted_eta: (poRow.targeted_eta ?? null) as string | null,
    supplier_eta: (poRow.supplier_eta ?? null) as string | null,
    logistics_eta: (poRow.logistics_eta ?? null) as string | null,
    current_eta_to_port: currentEtaToPort(poRow as any),
    actual_eta: (poRow.actual_eta ?? null) as string | null,
    eta_to_warehouse: (poRow.eta_to_warehouse ?? null) as string | null,
    clearance_status: (poRow.clearance_status ?? null) as string | null,
    eta_delayed: !!poRow.eta_delayed,
    delay_reason: (poRow.delay_reason ?? null) as string | null,
  };

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
            <Detail
              label="Expected invoice amount"
              value={money(poRow.expected_invoice_amount, poRow.invoice_currency || cur)}
            />
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

      {/* Shipment & ETA */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Shipment &amp; ETA</CardTitle>
          {shipmentData.eta_delayed && (
            <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700">
              Delayed
            </span>
          )}
        </CardHeader>
        <CardContent>
          <ShipmentForms data={shipmentData} caps={shipmentCaps} />
        </CardContent>
      </Card>

      {/* Documents */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Documents</CardTitle>
          <span className="text-xs text-gray-500">
            Green = uploaded (click to open) · grey = click to upload
          </span>
        </CardHeader>
        <CardContent>
          <DocBadges poId={poRow.id} docs={docs} canUpload={canUploadDoc} />
          {canUploadDoc && <DocUpload poId={poRow.id} />}
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

      {/* Shipping lines / incoming stock — shown once Logistics has captured any */}
      {incomingRows.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Incoming / shipped lines</CardTitle>
            <span className="text-xs text-gray-500">
              Feeds the dashboard&rsquo;s Incoming columns until marked arrived
            </span>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2 pl-4 pr-3 font-medium">Product</th>
                  <th className="py-2 px-3 font-medium text-right">Qty</th>
                  <th className="py-2 px-3 font-medium text-right">Amount</th>
                  <th className="py-2 px-3 font-medium">Expected date</th>
                  <th className="py-2 pr-4 pl-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {incomingRows.map((row) => {
                  const p = row.product as {
                    sku?: string;
                    name?: string;
                    product_family?: string | null;
                    variation?: string | null;
                  } | null;
                  const label = p?.product_family
                    ? `${p.product_family}${p.variation ? " — " + p.variation : ""}`
                    : p?.name || "—";
                  const cost = costByProduct.get(String(row.product_id));
                  const lineAmount =
                    cost && Number.isFinite(Number(row.quantity))
                      ? Number(row.quantity) * cost.unitCost
                      : null;
                  return (
                    <tr key={row.id} className="border-b border-gray-100">
                      <td className="py-2 pl-4 pr-3 text-gray-900">
                        {label}
                        {p?.sku && (
                          <span className="text-xs text-gray-400 ml-2">{p.sku}</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{row.quantity}</td>
                      <td className="py-2 px-3 text-right tabular-nums">
                        {money(lineAmount, cost?.currency)}
                      </td>
                      <td className="py-2 px-3">{date(row.expected_date)}</td>
                      <td className="py-2 pr-4 pl-3">
                        <span
                          className={
                            "text-[11px] px-2 py-0.5 rounded-full font-medium " +
                            (row.status === "ARRIVED"
                              ? "bg-emerald-100 text-emerald-700"
                              : row.status === "CANCELLED"
                                ? "bg-red-100 text-red-700"
                                : "bg-amber-100 text-amber-700")
                          }
                        >
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {hasLineValue && (
                <tfoot>
                  <tr className="border-t border-gray-200">
                    <td className="py-2 pl-4 pr-3 font-medium text-gray-700">
                      PO value (from lines)
                    </td>
                    <td />
                    <td className="py-2 px-3 text-right tabular-nums font-semibold text-gray-900">
                      {money(poValueFromLines, lineCurrency || cur)}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
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
              products={productOptions}
              receivingLines={incomingRows.map((r) => ({
                id: r.id as string,
                label: (() => {
                  const p = r.product as {
                    sku?: string;
                    name?: string;
                    product_family?: string | null;
                    variation?: string | null;
                  } | null;
                  return p?.product_family
                    ? `${p.product_family}${p.variation ? " — " + p.variation : ""}`
                    : p?.name || "—";
                })(),
                sku: (r.product as { sku?: string } | null)?.sku ?? null,
                quantity: r.quantity as number,
                remark: (r.notes ?? null) as string | null,
              }))}
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
