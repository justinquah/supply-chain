import { createClient, getCurrentUser, requireRole } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PO_WORKFLOW_LABELS,
  PO_WORKFLOW_COLORS,
  CLEARANCE_LABELS,
  CLEARANCE_COLORS,
  currentEtaToPort,
} from "@/lib/po-workflow";
import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";
import { SupplierDocLink } from "./doc-link";
import { SupplierDateEditor } from "./date-editor";

function date(d: string | null | undefined) {
  if (!d) return "—";
  // DATE columns are plain YYYY-MM-DD — format in UTC to avoid off-by-one.
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-MY", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function money(n: number | null | undefined, cur: string | null | undefined) {
  if (n == null) return "—";
  return `${cur || ""} ${Number(n).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`.trim();
}

type PoDoc = {
  id: string;
  doc_type: string;
  file_path: string;
  file_name: string;
};

export default async function SupplierPortalPage() {
  // Only the supplier themselves (plus SCM/ADMIN for support) can view this.
  await requireRole("SUPPLIER", "SCM", "ADMIN");
  const me = await getCurrentUser();
  const supabase = await createClient();

  // RLS scopes these queries to rows where supplier_id = auth.uid(). SCM/ADMIN
  // would see nothing here (they have their own admin views) — that's fine.
  const [{ data: pos }, { data: productLinks }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select(
        "id, po_number, status, currency, invoice_currency, expected_invoice_amount, " +
          "invoice_amount, targeted_eta, actual_eta, created_at, " +
          "etd, supplier_eta, logistics_eta, eta_to_warehouse, clearance_status, " +
          "po_documents(id, doc_type, file_path, file_name)"
      )
      .eq("supplier_id", me?.id ?? "")
      .order("created_at", { ascending: false }),
    supabase
      .from("product_suppliers")
      .select(
        "id, unit_cost, cost_currency, is_primary, " +
          "products(sku, name, product_family, variation)"
      )
      .eq("supplier_id", me?.id ?? ""),
  ]);

  const orders = (pos ?? []) as any[];
  const products = (productLinks ?? []) as any[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">My Orders</h1>
        <p className="text-sm text-gray-500 mt-1">
          Your purchase orders, documents, and product costs
        </p>
      </div>

      {/* My Purchase Orders */}
      <Card>
        <CardHeader>
          <CardTitle>My Purchase Orders</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {orders.length === 0 ? (
            <p className="text-sm text-gray-500 px-6 py-6">
              No purchase orders yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-100 bg-gray-50 text-[11px] uppercase tracking-wide text-left">
                    <th className="py-2 pl-6 pr-3 font-semibold">PO #</th>
                    <th className="py-2 px-3 font-semibold">Status</th>
                    <th className="py-2 px-3 font-semibold text-right">Amount</th>
                    <th className="py-2 px-3 font-semibold">My dates</th>
                    <th className="py-2 px-3 font-semibold">ETA to port</th>
                    <th className="py-2 px-3 font-semibold">Clearance</th>
                    <th className="py-2 px-3 font-semibold">ETA to WH</th>
                    <th className="py-2 pr-6 pl-3 font-semibold">Documents</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((po) => {
                    const cur = po.invoice_currency || po.currency || "MYR";
                    const amount =
                      po.invoice_amount ?? po.expected_invoice_amount ?? null;
                    const label =
                      PO_WORKFLOW_LABELS[po.status] ?? po.status ?? "—";
                    const color =
                      PO_WORKFLOW_COLORS[po.status] ??
                      "bg-gray-100 text-gray-700";
                    const docs = (po.po_documents ?? []) as PoDoc[];
                    return (
                      <tr
                        key={po.id}
                        className="border-b border-gray-100 align-top"
                      >
                        <td className="py-2.5 pl-6 pr-3 font-medium text-gray-900">
                          {po.po_number || "—"}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={
                              "inline-block text-[11px] px-1.5 py-0.5 rounded font-medium " +
                              color
                            }
                          >
                            {label}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-gray-700">
                          {money(amount, cur)}
                        </td>
                        <td className="py-2.5 px-3">
                          <SupplierDateEditor
                            poId={po.id}
                            etd={po.etd ?? null}
                            supplierEta={po.supplier_eta ?? null}
                          />
                        </td>
                        <td className="py-2.5 px-3 text-gray-600">
                          {date(currentEtaToPort(po))}
                        </td>
                        <td className="py-2.5 px-3">
                          {po.clearance_status ? (
                            <span
                              className={
                                "inline-block text-[11px] px-1.5 py-0.5 rounded font-medium " +
                                (CLEARANCE_COLORS[po.clearance_status] ||
                                  "bg-gray-100 text-gray-700")
                              }
                            >
                              {CLEARANCE_LABELS[po.clearance_status] ||
                                po.clearance_status}
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-gray-600">
                          {date(po.eta_to_warehouse)}
                        </td>
                        <td className="py-2.5 pr-6 pl-3">
                          {docs.length === 0 ? (
                            <span className="text-xs text-gray-400">None</span>
                          ) : (
                            <div className="flex flex-col gap-1">
                              {docs.map((d) => (
                                <div
                                  key={d.id}
                                  className="flex items-center gap-2"
                                >
                                  <span className="text-xs text-gray-600 w-24 truncate">
                                    {DOCUMENT_TYPE_LABELS[d.doc_type] ||
                                      d.doc_type}
                                  </span>
                                  <SupplierDocLink
                                    poId={po.id}
                                    filePath={d.file_path}
                                    fileName={d.file_name}
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* My Products & Costs */}
      <Card>
        <CardHeader>
          <CardTitle>My Products &amp; Costs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {products.length === 0 ? (
            <p className="text-sm text-gray-500 px-6 py-6">
              No products assigned yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-100 bg-gray-50 text-[11px] uppercase tracking-wide text-left">
                    <th className="py-2 pl-6 pr-3 font-semibold">SKU</th>
                    <th className="py-2 px-3 font-semibold">Product</th>
                    <th className="py-2 px-3 font-semibold">Variation</th>
                    <th className="py-2 pr-6 pl-3 font-semibold text-right">
                      Unit cost
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((ps) => {
                    const p = ps.products as {
                      sku?: string;
                      name?: string;
                      product_family?: string | null;
                      variation?: string | null;
                    } | null;
                    return (
                      <tr key={ps.id} className="border-b border-gray-100">
                        <td className="py-2.5 pl-6 pr-3 font-medium text-gray-900">
                          {p?.sku || "—"}
                        </td>
                        <td className="py-2.5 px-3 text-gray-700">
                          {p?.product_family || p?.name || "—"}
                          {ps.is_primary && (
                            <span className="ml-2 text-[11px] text-emerald-700">
                              primary
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-gray-600">
                          {p?.variation || "—"}
                        </td>
                        <td className="py-2.5 pr-6 pl-3 text-right tabular-nums text-gray-700">
                          {money(ps.unit_cost, ps.cost_currency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
