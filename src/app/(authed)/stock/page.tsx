import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { StockForm } from "./stock-form";

export default async function StockPage() {
  const supabase = await createClient();
  const profile = await getCurrentUser();
  const canEdit = ["SUPER_ADMIN", "SCM", "ADMIN"].includes(profile?.role ?? "");

  const { data: dash } = await supabase
    .from("product_dashboard")
    .select("id, sku, name, product_family, variation, current_stock")
    .eq("is_active", true)
    .order("product_family", { ascending: true });

  const rows = (dash ?? []).map((p: any) => ({
    id: p.id,
    sku: p.sku,
    label:
      (p.product_family || p.name) +
      (p.variation ? ` · ${p.variation}` : ""),
    current: Number(p.current_stock || 0),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Stock Levels</h1>
        <p className="text-sm text-gray-500 mt-1">
          {canEdit
            ? "Enter current stock per product. Saving records a weekly snapshot used by the KPI dashboard."
            : "Current stock per product (view only). Ask a Supply Chain Manager or Admin to update."}
        </p>
      </div>
      <StockForm rows={rows} canEdit={canEdit} />
    </div>
  );
}
