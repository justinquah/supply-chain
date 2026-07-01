import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MonthSelector } from "@/components/month-selector";
import { SalesUploadForm } from "./sales-upload-form";
import { ManualSalesForm } from "./manual-sales-form";
import { getManualSalesProducts } from "./actions";

const MONTHS = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function fmt(n: number) {
  return Math.round(n).toLocaleString("en-MY");
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const supabase = await createClient();
  const sp = await searchParams;
  const profile = await getCurrentUser();
  const canUpload = !!profile && (["SCM", "ADMIN"] as string[]).includes(profile.role);

  // Pull all monthly_sales rows (RLS allows all authenticated to read)
  const { data: sales } = await supabase
    .from("monthly_sales")
    .select("year, month, channel, units_equivalent, main_product_id");

  const rows = sales ?? [];

  // Build period totals
  const periods = new Map<
    string,
    { year: number; month: number; online: number; offline: number }
  >();
  for (const r of rows) {
    const key = `${r.year}-${r.month}`;
    const p =
      periods.get(key) ||
      { year: r.year, month: r.month, online: 0, offline: 0 };
    if (r.channel === "ONLINE") p.online += Number(r.units_equivalent);
    else p.offline += Number(r.units_equivalent);
    periods.set(key, p);
  }
  const periodList = [...periods.values()].sort(
    (a, b) => a.year - b.year || a.month - b.month
  );

  // Selected month for per-product breakdown (default: latest)
  const latest = periodList[periodList.length - 1];
  const selYear = sp.y ? Number(sp.y) : latest?.year;
  const selMonth = sp.m ? Number(sp.m) : latest?.month;

  // Per-product breakdown for the selected month
  const { data: detail } = await supabase
    .from("monthly_sales")
    .select("channel, units_equivalent, main_product_id, products(sku, product_family, variation, name)")
    .eq("year", selYear)
    .eq("month", selMonth);

  const prodMap = new Map<
    string,
    { label: string; sku: string; online: number; offline: number }
  >();
  for (const d of detail ?? []) {
    const prod = (d as any).products;
    const key = d.main_product_id;
    const label = prod
      ? `${prod.product_family || prod.name}${prod.variation ? " · " + prod.variation : ""}`
      : "Unknown";
    const e =
      prodMap.get(key) || { label, sku: prod?.sku || "", online: 0, offline: 0 };
    if (d.channel === "ONLINE") e.online += Number(d.units_equivalent);
    else e.offline += Number(d.units_equivalent);
    prodMap.set(key, e);
  }
  const prodList = [...prodMap.values()]
    .map((p) => ({ ...p, total: p.online + p.offline }))
    .sort((a, b) => b.total - a.total);

  // Data for the manual-entry grid: all active products (for the picker) plus
  // any existing units for the selected month, so entry is pre-filled and
  // editable rather than starting blank every time.
  const manualYear = selYear ?? new Date().getFullYear();
  const manualMonth = selMonth ?? new Date().getMonth() + 1;
  let manualProducts: Awaited<ReturnType<typeof getManualSalesProducts>>["products"] = [];
  if (canUpload) {
    const res = await getManualSalesProducts(manualYear, manualMonth);
    manualProducts = res.products ?? [];
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Sales</h1>
        <p className="text-sm text-gray-500 mt-1">
          Units sold by month and channel (main-product equivalent units)
        </p>
      </div>

      {canUpload && <SalesUploadForm />}

      {canUpload && (
        <ManualSalesForm
          products={manualProducts ?? []}
          initialYear={manualYear}
          initialMonth={manualMonth}
        />
      )}

      {/* Monthly totals */}
      <Card>
        <CardHeader>
          <CardTitle>Monthly totals</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-3 font-medium">Month</th>
                <th className="py-2 px-3 font-medium text-right">Online</th>
                <th className="py-2 px-3 font-medium text-right">Offline</th>
                <th className="py-2 pl-3 font-medium text-right">Total</th>
                <th className="py-2 pl-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {periodList.map((p) => {
                const sel = p.year === selYear && p.month === selMonth;
                return (
                  <tr
                    key={`${p.year}-${p.month}`}
                    className={
                      "border-b border-gray-100 " +
                      (sel ? "bg-brand/10" : "hover:bg-gray-50")
                    }
                  >
                    <td className="py-2 pr-3 font-medium">
                      {MONTHS[p.month]} {p.year}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-600">
                      {fmt(p.online)}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-600">
                      {fmt(p.offline)}
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums font-semibold">
                      {fmt(p.online + p.offline)}
                    </td>
                    <td className="py-2 pl-3 text-right">
                      <a
                        href={`/sales?y=${p.year}&m=${p.month}`}
                        className="text-xs text-brand hover:underline"
                      >
                        {sel ? "viewing" : "view breakdown"}
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Per-product breakdown */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>
            Breakdown — {MONTHS[selMonth] ?? ""} {selYear}
          </CardTitle>
          {periodList.length > 0 && (
            <MonthSelector
              months={periodList.map((p) => ({ year: p.year, month: p.month }))}
              selected={{ year: selYear, month: selMonth }}
            />
          )}
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-3 font-medium">Product</th>
                  <th className="py-2 px-3 font-medium text-right">Online</th>
                  <th className="py-2 px-3 font-medium text-right">Offline</th>
                  <th className="py-2 pl-3 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {prodList.map((p, i) => (
                  <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-gray-900">{p.label}</div>
                      <div className="text-xs text-gray-400">{p.sku}</div>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-600">
                      {fmt(p.online)}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-600">
                      {fmt(p.offline)}
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums font-semibold">
                      {fmt(p.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {prodList.length === 0 && (
            <p className="text-sm text-gray-500 py-8 text-center">
              No sales data for this month.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
