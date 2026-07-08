import Link from "next/link";
import { requireRole } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ImportPurchaseOrdersForm } from "./import-form";

// The accepted column template (shown inline so the SCM can build their sheet).
// [column, required?, note]
const COLUMNS: [string, boolean, string][] = [
  ["po_number", true, "upsert key — matches on existing PO number, else creates a new PO"],
  ["supplier", false, "matched to a supplier by company name (required when creating a new PO)"],
  ["status", false, "Draft · PO Approved · Invoice Received · Shipped · Received (default Draft)"],
  ["product_group", false, "product range this PO covers"],
  ["currency", false, "MYR · USD · CNY · THB (default MYR)"],
  ["total_amount", false, "expected order value"],
  ["payment_terms", false, 'e.g. "30% deposit, 70% before shipment"'],
  ["deposit_percent", false, "0–100"],
  ["deposit_due_date", false, "YYYY-MM-DD or Excel date"],
  ["balance_due_date", false, "YYYY-MM-DD or Excel date"],
  ["targeted_eta", false, "YYYY-MM-DD or Excel date"],
  ["etd", false, "YYYY-MM-DD or Excel date"],
  ["supplier_eta", false, "YYYY-MM-DD or Excel date"],
  ["logistics_eta", false, "YYYY-MM-DD or Excel date"],
  ["eta_to_warehouse", false, "YYYY-MM-DD or Excel date"],
  ["actual_eta", false, "YYYY-MM-DD or Excel date"],
  ["invoice_date", false, "YYYY-MM-DD or Excel date"],
  ["clearance_status", false, "In Transit · At Port · Under Clearance · Inspection · Cleared · To Warehouse · Received"],
  ["invoice_number", false, ""],
  ["invoice_amount", false, ""],
  ["notes", false, ""],
];

export default async function ImportPurchaseOrdersPage() {
  await requireRole("SCM", "ADMIN");

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link href="/purchase-orders" className="text-brand hover:underline">
            ← Purchase Orders
          </Link>
        </div>
        <h1 className="text-2xl font-semibold mt-1">Import purchase orders</h1>
        <p className="text-sm text-gray-500 mt-1">
          Upload an Excel/CSV of already-created POs. Rows are matched by{" "}
          <span className="font-medium">po_number</span>: an existing PO is updated
          (only the columns you provide), and an unknown PO number is created.
          Blank cells never overwrite existing data.
        </p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle>Upload file</CardTitle>
          <a
            href="/po-import-template.xlsx"
            download
            className="inline-flex items-center gap-1.5 rounded-md bg-brand/10 px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand/20"
          >
            ↓ Download Excel template
          </a>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500 mb-4">
            Start from the template — it has the exact headers, an example row, and
            an Instructions sheet listing allowed values and valid supplier names.
          </p>
          <ImportPurchaseOrdersForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accepted columns</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2 pl-4 pr-3 font-medium">Column</th>
                  <th className="py-2 px-3 font-medium">Required</th>
                  <th className="py-2 pr-4 pl-3 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {COLUMNS.map(([col, required, note]) => (
                  <tr key={col} className="border-b border-gray-100">
                    <td className="py-2 pl-4 pr-3 font-mono text-xs text-gray-800">{col}</td>
                    <td className="py-2 px-3">
                      {required ? (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
                          required
                        </span>
                      ) : (
                        <span className="text-gray-400">optional</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 pl-3 text-gray-500">{note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400 px-4 py-3">
            Column names are matched case- and space-insensitively (e.g. &quot;PO
            Number&quot;, &quot;po_number&quot;). Dates accept YYYY-MM-DD, real
            Excel dates, or Excel serial numbers.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
