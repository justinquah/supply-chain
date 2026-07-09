import { requireRole, createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SupplierCard } from "./supplier-card";

export default async function SuppliersPage() {
  // Gate: only SCM/ADMIN manage supplier configuration.
  await requireRole("SCM", "ADMIN");

  const supabase = await createClient();

  const [{ data: suppliers }, { data: allProducts }] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, name, company_name, email, supplier_payment_terms, supplier_deposit_percent, " +
          "product_suppliers(id, product_id, unit_cost, cost_currency, is_primary, order_unit, " +
          "products(id, sku, name, product_family, variation, units_per_carton))"
      )
      .not("company_name", "is", null)
      .order("company_name"),
    supabase
      .from("products")
      .select("id, sku, name, product_family, variation, units_per_carton, is_active")
      .eq("is_active", true)
      .order("product_family", { ascending: true }),
  ]);

  const supplierIds = (suppliers ?? []).map((s: any) => s.id);
  const { data: costHistory } =
    supplierIds.length > 0
      ? await supabase
          .from("product_supplier_cost_history")
          .select("product_id, supplier_id, unit_cost, cost_currency, effective_from, note")
          .in("supplier_id", supplierIds)
          .order("effective_from", { ascending: false })
      : { data: [] };

  const historyByKey = new Map<string, any[]>();
  for (const h of costHistory ?? []) {
    const key = `${h.supplier_id}:${h.product_id}`;
    if (!historyByKey.has(key)) historyByKey.set(key, []);
    historyByKey.get(key)!.push(h);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Suppliers</h1>
        <p className="text-sm text-gray-500 mt-1">
          Payment terms, products supplied, cost per product, and cost-change history
          per supplier
        </p>
      </div>

      {(suppliers ?? []).length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-gray-400">
            No suppliers found. A supplier is any profile with a company name set.
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {(suppliers ?? []).map((s: any) => (
          <SupplierCard
            key={s.id}
            supplier={{
              id: s.id,
              name: s.name,
              companyName: s.company_name,
              email: s.email,
              paymentTerms: s.supplier_payment_terms,
              depositPercent: s.supplier_deposit_percent,
            }}
            productSuppliers={s.product_suppliers ?? []}
            historyByKey={Object.fromEntries(historyByKey)}
            allProducts={allProducts ?? []}
          />
        ))}
      </div>
    </div>
  );
}
