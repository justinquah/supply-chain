import Link from "next/link";
import { createClient, getCurrentUser, requireRole } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PoForm } from "./po-form";
import { DocBadges } from "./doc-badge";
import {
  PO_DRAFT_CREATORS,
  PO_WORKFLOW_COLORS,
  PO_WORKFLOW_LABELS,
  canActOnState,
} from "@/lib/po-workflow";

function money(n: number | null, cur: string | null) {
  if (n == null) return "—";
  return `${cur || "MYR"} ${Number(n).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default async function PurchaseOrdersPage() {
  // Internal-only: rejects STAFF and SUPPLIER (suppliers use /supplier).
  await requireRole("SCM", "ADMIN", "ACCOUNTS", "FINANCE", "WAREHOUSE", "LOGISTICS");
  const supabase = await createClient();
  const profile = await getCurrentUser();
  const role = profile?.role ?? "";
  const canDraft = PO_DRAFT_CREATORS.includes(role as never);

  const [{ data: pos }, { data: suppliers }, { data: groups }, { data: products }] =
    await Promise.all([
      supabase
        .from("purchase_orders")
        .select(
          "id, po_number, status, invoice_number, invoice_amount, expected_invoice_amount, invoice_currency, product_group, created_at, supplier:profiles!supplier_id(name, company_name), po_documents(id, doc_type, file_path, file_name)"
        )
        .order("created_at", { ascending: false }),
      // Phase-1 substitute: the SUPPLIER role was removed in migration 0011 (all SUPPLIER
      // rows remapped to ADMIN). Populate the supplier dropdown with any profile that has
      // a company_name — these are the actual supplier contacts in the system.
      supabase
        .from("profiles")
        .select("id, name, company_name")
        .not("company_name", "is", null)
        .order("company_name"),
      supabase.from("product_groups").select("name").order("name"),
      // Active products for the PO create form's product-lines picker.
      supabase
        .from("products")
        .select("id, sku, name, product_family")
        .eq("is_active", true)
        .order("sku"),
    ]);

  const rows = pos ?? [];
  const supplierOpts = (suppliers ?? []).map((s: any) => ({
    id: s.id,
    label: s.company_name || s.name,
  }));
  const groupNames = (groups ?? []).map((g: any) => g.name);
  const productOpts = (products ?? []).map((p: any) => ({
    id: p.id,
    label: `${p.sku} — ${p.name}`,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Purchase Orders</h1>
          <p className="text-sm text-gray-500 mt-1">
            Every PO tracked through its hand-offs: Draft → PO Approved → Invoice
            Received → Shipped → Received
          </p>
        </div>
        {canDraft && (
          <div className="flex items-center gap-2">
            <Link
              href="/purchase-orders/import"
              className="inline-flex items-center rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Import POs
            </Link>
            <Link
              href="/purchase-orders/import-docs"
              className="inline-flex items-center rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Import documents
            </Link>
            <Link
              href="/purchase-orders/import-lines"
              className="inline-flex items-center rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Import PO lines
            </Link>
            <PoForm suppliers={supplierOpts} groups={groupNames} products={productOpts} />
          </div>
        )}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{rows.length} records</CardTitle>
          <span className="text-xs text-gray-500">
            Click a PO number to open it · amber dot = needs your action
          </span>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2.5 pl-4 pr-3 font-medium">PO number</th>
                  <th className="py-2.5 px-3 font-medium">Status</th>
                  <th className="py-2.5 px-3 font-medium">Supplier</th>
                  <th className="py-2.5 px-3 font-medium text-right">Amount</th>
                  <th className="py-2.5 px-3 font-medium">Product range</th>
                  <th className="py-2.5 pr-4 pl-3 font-medium">Documents</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((po: any) => {
                  const needsYou = canActOnState(role, po.status);
                  const amount =
                    po.invoice_amount ?? po.expected_invoice_amount ?? null;
                  return (
                    <tr
                      key={po.id}
                      className="border-b border-gray-100 hover:bg-gray-50"
                    >
                      <td className="py-2.5 pl-4 pr-3 font-medium">
                        <Link
                          href={`/purchase-orders/${po.id}`}
                          className="text-brand hover:underline"
                        >
                          {po.po_number || (
                            <span className="text-gray-400 italic">draft</span>
                          )}
                        </Link>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={
                              "text-[11px] px-2 py-0.5 rounded-full font-medium " +
                              (PO_WORKFLOW_COLORS[po.status] ||
                                "bg-gray-100 text-gray-700")
                            }
                          >
                            {PO_WORKFLOW_LABELS[po.status] || po.status}
                          </span>
                          {needsYou && (
                            <span
                              title="Needs your action"
                              className="inline-block h-2 w-2 rounded-full bg-amber-500"
                            />
                          )}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-gray-600">
                        {po.supplier?.company_name || po.supplier?.name || "—"}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-gray-600">
                        {money(amount, po.invoice_currency)}
                      </td>
                      <td className="py-2.5 px-3 text-gray-600">
                        {po.product_group || "—"}
                      </td>
                      <td className="py-2.5 pr-4 pl-3">
                        <DocBadges docs={po.po_documents || []} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && (
            <p className="text-sm text-gray-500 py-10 text-center">
              No purchase orders yet.{" "}
              {canDraft ? "Click “New PO (draft)” to add one." : ""}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
