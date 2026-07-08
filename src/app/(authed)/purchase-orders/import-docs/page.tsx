import Link from "next/link";
import { createClient, requireRole } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BulkDocImport } from "./bulk-doc-import";

export default async function ImportDocsPage() {
  await requireRole("SCM", "ADMIN");
  const supabase = await createClient();

  const { data: pos } = await supabase
    .from("purchase_orders")
    .select("id, po_number")
    .order("po_number", { ascending: true });

  // Only POs that carry a po_number can be filename-matched; keep the rest in the
  // dropdown so the user can still attach a doc to a draft manually.
  const options = (pos ?? []).map((p) => ({
    id: String(p.id),
    po_number: p.po_number ? String(p.po_number) : "",
  }));

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link href="/purchase-orders" className="text-brand hover:underline">
            ← Purchase Orders
          </Link>
        </div>
        <h1 className="text-2xl font-semibold mt-1">Import documents</h1>
        <p className="text-sm text-gray-500 mt-1">
          Drop in a batch of files. Each is auto-matched to a PO by its filename
          (the PO number found inside the name) and given a best-guess document
          type. Review the preview, fix anything, then upload.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bulk upload documents</CardTitle>
        </CardHeader>
        <CardContent>
          <BulkDocImport pos={options} />
        </CardContent>
      </Card>
    </div>
  );
}
