import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const MONTHS = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const IDEAL_COVERAGE = 1.5;
const HORIZON = 6; // months to project

function fmt(n: number) {
  return Math.round(n).toLocaleString("en-MY");
}

export default async function ProjectionPage() {
  const supabase = await createClient();

  const { data: dash } = await supabase
    .from("product_dashboard")
    .select("id, sku, name, product_family, variation, current_stock, ams_total")
    .eq("is_main", true)
    .eq("is_active", true)
    .order("ams_total", { ascending: false });

  const products = dash ?? [];

  // Incoming stock grouped by product + (year, month)
  const { data: incoming } = await supabase
    .from("incoming_stock")
    .select("product_id, quantity, expected_date")
    .eq("status", "EXPECTED");

  const incomingByProductMonth = new Map<string, number>(); // `${pid}|${y}-${m}` -> qty
  for (const r of incoming ?? []) {
    const d = new Date(r.expected_date);
    const key = `${r.product_id}|${d.getFullYear()}-${d.getMonth() + 1}`;
    incomingByProductMonth.set(
      key,
      (incomingByProductMonth.get(key) || 0) + Number(r.quantity)
    );
  }

  // Build month columns starting this month
  const now = new Date();
  const cols: { year: number; month: number }[] = [];
  for (let i = 0; i < HORIZON; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    cols.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }

  // Per product: project end-of-month inventory + find first reorder month
  const projected = products.map((p) => {
    const ams = Number(p.ams_total || 0);
    let running = Number(p.current_stock || 0);
    let reorderMonth: string | null = null;
    const cells = cols.map((c, idx) => {
      const inc =
        incomingByProductMonth.get(`${p.id}|${c.year}-${c.month}`) || 0;
      running = running - ams + inc;
      const coverage = ams > 0 ? running / ams : null;
      const low = coverage != null && coverage < IDEAL_COVERAGE;
      if (low && reorderMonth === null) {
        reorderMonth = `${MONTHS[c.month]} ${c.year}`;
      }
      return { ...c, endStock: running, coverage, low, incoming: inc };
    });
    return { ...p, ams, cells, reorderMonth };
  });

  // Only show products that actually sell (ams > 0)
  const active = projected.filter((p) => p.ams > 0);
  const reorderCount = active.filter((p) => p.reorderMonth).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Inventory Projection</h1>
        <p className="text-sm text-gray-500 mt-1">
          Projected end-of-month stock = opening − AMS × months + incoming.
          Cells turn red below {IDEAL_COVERAGE}-month coverage.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Stat label="Products tracked" value={fmt(active.length)} />
        <Stat
          label="Need reorder in horizon"
          value={fmt(reorderCount)}
          danger={reorderCount > 0}
        />
        <Stat label="Horizon" value={`${HORIZON} months`} />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Projection matrix</CardTitle>
          <span className="text-xs text-gray-500">
            Stock is 0 until you enter levels on the Stock page
          </span>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-3 font-medium sticky left-0 bg-white">
                    Product
                  </th>
                  <th className="py-2 px-2 font-medium text-right">Stock now</th>
                  <th className="py-2 px-2 font-medium text-right">AMS</th>
                  {cols.map((c) => (
                    <th
                      key={`${c.year}-${c.month}`}
                      className="py-2 px-2 font-medium text-right whitespace-nowrap"
                    >
                      {MONTHS[c.month]} {String(c.year).slice(2)}
                    </th>
                  ))}
                  <th className="py-2 pl-2 font-medium">Reorder by</th>
                </tr>
              </thead>
              <tbody>
                {active.map((p) => (
                  <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 pr-3 sticky left-0 bg-white">
                      <div className="font-medium text-gray-900">
                        {p.product_family || p.name}
                        {p.variation ? (
                          <span className="text-gray-500 font-normal">
                            {" "}· {p.variation}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-gray-400">{p.sku}</div>
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      {fmt(Number(p.current_stock || 0))}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums text-gray-500">
                      {fmt(p.ams)}
                    </td>
                    {p.cells.map((cell, i) => (
                      <td
                        key={i}
                        className={
                          "py-2 px-2 text-right tabular-nums " +
                          (cell.low
                            ? "text-red-600 font-semibold bg-red-50"
                            : cell.endStock < 0
                            ? "text-red-600"
                            : "text-gray-700")
                        }
                        title={
                          cell.incoming
                            ? `Incoming this month: ${fmt(cell.incoming)}`
                            : undefined
                        }
                      >
                        {fmt(cell.endStock)}
                        {cell.coverage != null && (
                          <span className="block text-[10px] text-gray-400 font-normal">
                            {cell.coverage.toFixed(1)}mo
                          </span>
                        )}
                      </td>
                    ))}
                    <td className="py-2 pl-2">
                      {p.reorderMonth ? (
                        <span className="text-xs font-medium text-red-600">
                          {p.reorderMonth}
                        </span>
                      ) : (
                        <span className="text-xs text-emerald-700">OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {active.length === 0 && (
            <p className="text-sm text-gray-500 py-8 text-center">
              No products with sales history yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <div className="text-xs uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className={"text-xl font-semibold mt-1 " + (danger ? "text-red-600" : "")}>
        {value}
      </div>
    </div>
  );
}
