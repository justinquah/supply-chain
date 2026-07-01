import { createClient, requireRole } from "@/lib/supabase/server";
import { StockFormGrouped } from "./stock-form-grouped";
import { StockUploadForm } from "./stock-upload-form";

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth() + 1]} ${d.getFullYear()}`;
}

export default async function StockPage() {
  const supabase = await createClient();
  // Gate to SCM and ADMIN only; other roles are redirected to /login.
  await requireRole("SCM", "ADMIN");
  const canEdit = true; // requireRole guarantees the role is SCM or ADMIN

  // Fetch products with family/variation info
  const { data: dash } = await supabase
    .from("product_dashboard")
    .select("id, sku, name, product_family, variation, current_stock")
    .eq("is_active", true)
    .order("product_family", { ascending: true });

  // Fetch the latest stock snapshot per product (for recorded_at date)
  const { data: latestSnapshots } = await supabase
    .from("latest_stock")
    .select("product_id, recorded_at");

  // Build a lookup of product_id → recorded_at
  const snapshotDateMap: Record<string, string> = {};
  for (const s of latestSnapshots ?? []) {
    snapshotDateMap[s.product_id] = s.recorded_at;
  }

  // Find the overall latest snapshot date for the page header
  const latestDate =
    latestSnapshots && latestSnapshots.length > 0
      ? latestSnapshots.reduce((best, s) => {
          return !best || s.recorded_at > best ? s.recorded_at : best;
        }, "" as string)
      : null;

  const rows = (dash ?? []).map((p: any) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    product_family: p.product_family ?? null,
    variation: p.variation ?? null,
    current: Number(p.current_stock || 0),
    recorded_at: snapshotDateMap[p.id] ?? null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Stock Levels</h1>
        <p className="text-sm text-gray-500 mt-1">
          {canEdit
            ? "Enter current stock per product. Saving records a weekly snapshot used by the KPI dashboard."
            : "Current stock per product (view only). Ask a Supply Chain Manager or Admin to update."}
          {latestDate && (
            <span className="ml-2 text-gray-400">
              Stock as of{" "}
              <span className="font-medium text-gray-600">{fmtDate(latestDate)}</span>
            </span>
          )}
        </p>
      </div>
      {canEdit && <StockUploadForm />}
      <StockFormGrouped rows={rows} canEdit={canEdit} />
    </div>
  );
}
