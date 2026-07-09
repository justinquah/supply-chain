import { createClient, getCurrentUser, requireRole } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { LaunchDateCell } from "./launch-date-cell";
import { PackFieldCell } from "./pack-field-cell";
import { AddProductForm } from "./add-product-form";
import { ImportProductsForm } from "./import-products-form";

function money(n: number | null, cur: string | null) {
  if (n == null) return "—";
  return `${cur || ""} ${Number(n).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`.trim();
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  // Internal-only: rejects STAFF and SUPPLIER.
  await requireRole("SCM", "ADMIN", "ACCOUNTS", "FINANCE", "WAREHOUSE", "LOGISTICS");
  const supabase = await createClient();
  const sp = await searchParams;
  const showInactive = sp.show === "all";
  const profile = await getCurrentUser();
  const canManage = !!profile && (["SCM", "ADMIN"] as string[]).includes(profile.role);

  let query = supabase
    .from("products")
    .select(
      "id, sku, name, product_family, variation, pack_size, launch_date, is_main, is_active, unit_cost, cost_currency, units_per_carton, stock_pieces_per_unit, product_categories(name), product_suppliers(unit_cost, cost_currency, is_primary, profiles(name, company_name))"
    )
    .order("variation", { ascending: true });
  if (!showInactive) query = query.eq("is_active", true);

  const [{ data: products }, { data: groups }] = await Promise.all([
    query,
    supabase.from("product_groups").select("name, loading_capacity, product_categories(name)"),
  ]);

  const groupMeta = new Map<string, any>();
  for (const g of groups ?? []) groupMeta.set(g.name, g);

  // Group products by family
  const byFamily = new Map<string, any[]>();
  for (const p of products ?? []) {
    const fam = p.product_family || p.name;
    if (!byFamily.has(fam)) byFamily.set(fam, []);
    byFamily.get(fam)!.push(p);
  }
  const families = [...byFamily.keys()].sort();

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Products</h1>
          <p className="text-sm text-gray-500 mt-1">
            By product range → variation · load size is the container total for the
            whole range
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Launch date drives the KPI new-SKU exclusion — a SKU only counts toward
            Overstock %/OOS % more than 6 months after launch.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          {canManage && (
            <a
              href="/products/sku-codes"
              className="px-3 py-1.5 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              Manage SKU codes
            </a>
          )}
          <a
            href="/products"
            className={
              "px-3 py-1.5 rounded-md " +
              (!showInactive ? "bg-brand/10 text-brand" : "text-gray-600 hover:bg-gray-50")
            }
          >
            Active
          </a>
          <a
            href="/products?show=all"
            className={
              "px-3 py-1.5 rounded-md " +
              (showInactive ? "bg-brand/10 text-brand" : "text-gray-600 hover:bg-gray-50")
            }
          >
            All
          </a>
        </div>
      </div>

      {canManage && (
        <div className="grid md:grid-cols-2 gap-4">
          <AddProductForm />
          <ImportProductsForm />
        </div>
      )}

      <div className="space-y-4">
        {families.map((fam) => {
          const items = byFamily.get(fam)!;
          const meta = groupMeta.get(fam);
          const loadSize = meta?.loading_capacity;
          const category = meta?.product_categories?.name || items[0]?.product_categories?.name;
          return (
            <Card key={fam}>
              <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2 bg-gray-50/60 rounded-t-lg">
                <div>
                  <div className="font-semibold text-gray-900">{fam}</div>
                  <div className="text-xs text-gray-500">
                    {category || "—"} · {items.length} variation
                    {items.length === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex gap-6 text-sm">
                  <div className="text-right">
                    <div className="text-xs text-gray-500">Load size (range total)</div>
                    <div className="font-medium tabular-nums">
                      {loadSize
                        ? Number(loadSize).toLocaleString("en-MY") + " units/container"
                        : "—"}
                    </div>
                  </div>
                </div>
              </div>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-100">
                      <th className="py-2 pl-4 pr-3 font-medium">Variation</th>
                      <th className="py-2 px-3 font-medium">Primary supplier</th>
                      <th className="py-2 px-3 font-medium text-right">Cost/unit</th>
                      <th className="py-2 px-3 font-medium">Pack</th>
                      <th className="py-2 px-3 font-medium text-right">Units / carton</th>
                      <th
                        className="py-2 px-3 font-medium text-right"
                        title="Pieces the stock file counts per main unit — imports divide by this"
                      >
                        Stock pcs / unit
                      </th>
                      <th className="py-2 pr-4 pl-3 font-medium">Launch date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((p: any) => {
                      const suppliers = p.product_suppliers || [];
                      const primary = suppliers.find((s: any) => s.is_primary) || suppliers[0];
                      const supplierName =
                        primary?.profiles?.company_name || primary?.profiles?.name || "—";
                      const altCount = suppliers.length > 1 ? suppliers.length - 1 : 0;
                      return (
                        <tr
                          key={p.id}
                          className={
                            "border-b border-gray-50 last:border-0 " +
                            (!p.is_active ? "opacity-50" : "")
                          }
                        >
                          <td className="py-2 pl-4 pr-3">
                            <span className="text-gray-900">
                              {p.variation || p.name}
                            </span>
                            {!p.is_main && (
                              <span className="ml-2 text-[10px] uppercase bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                                GWP
                              </span>
                            )}
                            {!p.is_active && (
                              <span className="ml-2 text-[10px] uppercase bg-red-50 text-red-600 px-1.5 py-0.5 rounded">
                                discontinued
                              </span>
                            )}
                            <div className="text-xs text-gray-400">{p.sku}</div>
                          </td>
                          <td className="py-2 px-3 text-gray-600">
                            {supplierName}
                            {altCount > 0 && (
                              <span className="text-xs text-gray-400"> +{altCount} alt</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-gray-600">
                            {money(
                              primary?.unit_cost ?? p.unit_cost,
                              primary?.cost_currency ?? p.cost_currency
                            )}
                          </td>
                          <td className="py-2 px-3 text-gray-500 text-xs">
                            {p.pack_size || "—"}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {canManage ? (
                              <div className="flex justify-end">
                                <PackFieldCell
                                  productId={p.id}
                                  field="units_per_carton"
                                  value={p.units_per_carton}
                                />
                              </div>
                            ) : (
                              <span className="tabular-nums text-gray-600">
                                {p.units_per_carton ?? 1}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {canManage ? (
                              <div className="flex justify-end">
                                <PackFieldCell
                                  productId={p.id}
                                  field="stock_pieces_per_unit"
                                  value={p.stock_pieces_per_unit}
                                />
                              </div>
                            ) : (
                              <span className="tabular-nums text-gray-600">
                                {p.stock_pieces_per_unit ?? 1}
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-4 pl-3">
                            <LaunchDateCell
                              productId={p.id}
                              launchDate={p.launch_date}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
