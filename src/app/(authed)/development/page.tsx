import { requireRole, createClient } from "@/lib/supabase/server";
import { DevManager, type DevItem } from "./dev-manager";

export default async function DevelopmentPage() {
  // Gate: only SCM/ADMIN manage the development pipeline.
  await requireRole("SCM", "ADMIN");

  const supabase = await createClient();

  const [{ data: items }, { data: products }] = await Promise.all([
    supabase
      .from("product_development_items")
      .select(
        "id, name, product_family, variation, planned_launch_date, status, " +
          "linked_product_id, notes, products(id, sku, name, product_family, variation)"
      )
      // Nulls-last on planned_launch_date, then ascending.
      .order("planned_launch_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("products")
      .select("id, sku, name, product_family, variation")
      .eq("is_active", true)
      .order("product_family", { ascending: true }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Product Development</h1>
        <p className="text-sm text-gray-500 mt-1">
          Upcoming product launches and their status
        </p>
      </div>

      <DevManager
        items={(items ?? []) as unknown as DevItem[]}
        products={(products ?? []) as never[]}
      />
    </div>
  );
}
