import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PoForm } from "./po-form";
import { DocBadges } from "./doc-badge";

const CAN_WRITE = ["SCM", "ACCOUNTS", "ADMIN", "FINANCE"];

function money(n: number | null, cur: string | null) {
  if (n == null) return "—";
  return `${cur || "MYR"} ${Number(n).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default async function PurchaseOrdersPage() {
  const supabase = await createClient();
  const profile = await getCurrentUser();
  const canWrite = CAN_WRITE.includes(profile?.role ?? "");

  const [{ data: pos }, { data: suppliers }, { data: groups }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select(
        "id, po_number, invoice_number, invoice_amount, invoice_currency, product_group, created_at, supplier:profiles!supplier_id(name, company_name), po_documents(id, doc_type, file_path, file_name)"
      )
      .order("created_at", { ascending: false }),
    // Phase-1 substitute: the SUPPLIER role was removed in migration 0011 (all SUPPLIER
    // rows remapped to ADMIN). Populate the supplier dropdown with any profile that has
    // a company_name — these are the actual supplier contacts in the system.
    // TODO Phase 4: redesign the PO supplier model (brief says suppliers operate off-app).
    supabase
      .from("profiles")
      .select("id, name, company_name")
      .not("company_name", "is", null)
      .order("company_name"),
    supabase.from("product_groups").select("name").order("name"),
  ]);

  const rows = pos ?? [];
  const supplierOpts = (suppliers ?? []).map((s: any) => ({
    id: s.id,
    label: s.company_name || s.name,
  }));
  const groupNames = (groups ?? []).map((g: any) => g.name);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">PO &amp; Invoices</h1>
          <p className="text-sm text-gray-500 mt-1">
            Register and store every PO, Invoice, BL, Packing List, and K1
          </p>
        </div>
        {canWrite && <PoForm suppliers={supplierOpts} groups={groupNames} />}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{rows.length} records</CardTitle>
          <span className="text-xs text-gray-500">
            Green badge = uploaded (click to open) · grey = missing
          </span>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2.5 pl-4 pr-3 font-medium">PO number</th>
                  <th className="py-2.5 px-3 font-medium">Invoice number</th>
                  <th className="py-2.5 px-3 font-medium">Supplier</th>
                  <th className="py-2.5 px-3 font-medium text-right">Invoice amount</th>
                  <th className="py-2.5 px-3 font-medium">Product range</th>
                  <th className="py-2.5 pr-4 pl-3 font-medium">Documents</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((po: any) => (
                  <tr key={po.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2.5 pl-4 pr-3 font-medium text-gray-900">
                      {po.po_number}
                    </td>
                    <td className="py-2.5 px-3 text-gray-600">
                      {po.invoice_number || "—"}
                    </td>
                    <td className="py-2.5 px-3 text-gray-600">
                      {po.supplier?.company_name || po.supplier?.name || "—"}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-gray-600">
                      {money(po.invoice_amount, po.invoice_currency)}
                    </td>
                    <td className="py-2.5 px-3 text-gray-600">
                      {po.product_group || "—"}
                    </td>
                    <td className="py-2.5 pr-4 pl-3">
                      <DocBadges docs={po.po_documents || []} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && (
            <p className="text-sm text-gray-500 py-10 text-center">
              No PO/invoice records yet.{" "}
              {canWrite ? "Click “New PO / Invoice” to add one." : ""}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
