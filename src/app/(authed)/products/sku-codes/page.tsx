import { createClient, requireRole } from "@/lib/supabase/server";
import { SkuCodesManager } from "./sku-codes-manager";

export default async function SkuCodesPage() {
  // Managing SKU codes is an SCM/ADMIN capability (matches the sku_mappings RLS write policy).
  await requireRole("SCM", "ADMIN");
  const supabase = await createClient();

  const [{ data: products }, { data: mappings }] = await Promise.all([
    supabase
      .from("products")
      .select("id, sku, name, product_family, is_active")
      .order("sku", { ascending: true }),
    supabase
      .from("sku_mappings")
      .select(
        "id, variant_sku, variant_name, main_product_id, units_per_variant, notes, products:main_product_id(sku, name)"
      )
      .order("variant_sku", { ascending: true }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">SKU Codes</h1>
        <p className="text-sm text-gray-500 mt-1 max-w-3xl">
          Alternate codes from your inventory / online / offline sales files that map to a
          main SKU. Set how many of the code equal one main unit — imports convert
          automatically.
        </p>
      </div>

      <SkuCodesManager
        products={(products ?? []) as any}
        mappings={(mappings ?? []) as any}
      />
    </div>
  );
}
