import Link from "next/link";
import { requireRole } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ImportPoLinesForm } from "./import-lines-form";

// The accepted column template (shown inline). [column, required?, note]
const COLUMNS: [string, boolean, string][] = [
  ["po_number", true, "groups the lines; matches an existing PO, else a new PO is created"],
  [
    "supplier",
    false,
    "matched by company name — required only when the PO does not exist yet (new POs must have a supplier)",
  ],
  ["sku", true, "product or variant SKU — resolved like sales (variant → main, with conversion factor)"],
  ["quantity", true, "quantity ordered (variant units; multiplied by the SKU factor)"],
  ["eta", false, "YYYY-MM-DD or Excel date — defaults to the PO's targeted ETA"],
];

export default async function ImportPoLinesPage() {
  await requireRole("SCM", "ADMIN");

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link href="/purchase-orders" className="text-brand hover:underline">
            ← Purchase Orders
          </Link>
        </div>
        <h1 className="text-2xl font-semibold mt-1">Import PO lines</h1>
        <p className="text-sm text-gray-500 mt-1">
          Backfill in-transit purchase orders with their product lines. Rows are
          grouped by <span className="font-medium">po_number</span>: lines attach
          to an existing PO, or — when the PO number is new and a{" "}
          <span className="font-medium">supplier</span> is given — a shipped PO is
          created for them. These lines feed the dashboard&rsquo;s Incoming /
          in-transit until the goods are received.
        </p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle>Upload file</CardTitle>
          <a
            href="/po-lines-template.xlsx"
            download
            className="inline-flex items-center gap-1.5 rounded-md bg-brand/10 px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand/20"
          >
            ↓ Download Excel template
          </a>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500 mb-4">
            Start from the template — it has the exact headers (po_number,
            supplier, sku, quantity, eta) and an example row. Re-importing lines
            for the same PO replaces the lines already captured for it.
          </p>
          <ImportPoLinesForm />
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
            Column names are matched case- and space-insensitively. Dates accept
            YYYY-MM-DD, real Excel dates, or Excel serial numbers. Unknown SKUs and
            non-positive quantities are skipped and listed after import.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
