import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GroupedInventory, type ProductRow } from "@/components/grouped-inventory";
import { MonthSelector } from "@/components/month-selector";

const IDEAL = 1.5;

function rm(v: number) {
  return "RM " + Math.round(v).toLocaleString("en-MY");
}
function num(v: number, dp = 0) {
  return Number(v).toLocaleString("en-MY", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}
const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const supabase = await createClient();
  const sp = await searchParams;

  // Available months from sales data
  const { data: monthRows } = await supabase
    .from("monthly_kpi")
    .select("year, month");
  const months = (monthRows ?? []).map((r) => ({ year: r.year, month: r.month }));
  const latest = months[months.length - 1] ?? {
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
  };
  const selYear = sp.y ? Number(sp.y) : latest.year;
  const selMonth = sp.m ? Number(sp.m) : latest.month;
  const isLatest = selYear === latest.year && selMonth === latest.month;

  // Use the as-of function so AMS reflects the 3 months ending at the selected month
  const [{ data: rows }, { data: weekly }] = await Promise.all([
    supabase.rpc("product_dashboard_asof", { p_year: selYear, p_month: selMonth }),
    supabase.from("inventory_weekly").select("*"),
  ]);

  const products = ((rows ?? []) as any[])
    .filter((p) => p.is_main && p.is_active)
    .sort((a, b) => Number(b.ams_total) - Number(a.ams_total)) as ProductRow[] & any[];

  // KPIs
  const inventoryValue = products.reduce(
    (s, p) => s + Number(p.inventory_value_myr || 0),
    0
  );
  const monthlySalesValue = products.reduce(
    (s, p) => s + Number(p.monthly_sales_value_myr || 0),
    0
  );

  // Value-weighted inventory turnover (coverage weighted by monthly sales value).
  let wNum = 0,
    wDen = 0;
  for (const p of products) {
    const cov = p.coverage_months;
    const w = Number(p.monthly_sales_value_myr || 0);
    if (cov != null && w > 0) {
      wNum += Number(cov) * w;
      wDen += w;
    }
  }
  const weightedTurnover = wDen > 0 ? wNum / wDen : null;

  const totalStock = products.reduce((s, p) => s + Number(p.current_stock || 0), 0);
  const totalAms = products.reduce((s, p) => s + Number(p.ams_total || 0), 0);
  const atRisk = products.filter(
    (p) => p.ams_total > 0 && p.coverage_months != null && Number(p.coverage_months) < IDEAL
  ).length;

  const weeks = weekly ?? [];
  const latestWeek = weeks[weeks.length - 1];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Inventory Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            By product range · AMS = 3 months ending {MONTHS[selMonth]} {selYear} ·
            values in MYR
            {!isLatest && (
              <span className="ml-2 text-amber-600">
                (viewing historical month)
              </span>
            )}
          </p>
        </div>
        {months.length > 0 && (
          <MonthSelector
            months={months}
            selected={{ year: selYear, month: selMonth }}
          />
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="Inventory value"
          value={rm(inventoryValue)}
          sub="at cost"
        />
        <Kpi
          label="Weighted turnover"
          value={weightedTurnover == null ? "—" : num(weightedTurnover, 2) + " mo"}
          sub={`target ${IDEAL} mo · weighted by sales value`}
          danger={weightedTurnover != null && weightedTurnover < IDEAL}
        />
        <Kpi
          label="Monthly sales value"
          value={rm(monthlySalesValue)}
          sub="at cost / month"
        />
        <Kpi
          label="Ranges below 1.5 mo"
          value={num(atRisk)}
          sub="products"
          danger={atRisk > 0}
        />
      </div>

      {/* Inventory health by week */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Inventory health by week</CardTitle>
          <span className="text-xs text-gray-500">
            Upload stock each Monday
          </span>
        </CardHeader>
        <CardContent>
          {weeks.length === 0 ? (
            <p className="text-sm text-gray-500 py-4">
              No stock snapshots yet.
            </p>
          ) : (
            <div className="flex items-end gap-4 flex-wrap">
              {weeks.map((w: any) => {
                const max = Math.max(
                  ...weeks.map((x: any) => Number(x.inventory_value_myr))
                );
                const h = max > 0 ? (Number(w.inventory_value_myr) / max) * 80 : 0;
                const d = new Date(w.week_start);
                return (
                  <div key={w.week_start} className="flex flex-col items-center gap-1">
                    <div className="text-xs text-gray-600 tabular-nums">
                      {rm(Number(w.inventory_value_myr))}
                    </div>
                    <div
                      className="w-12 bg-brand rounded-t"
                      style={{ height: `${Math.max(h, 4)}px` }}
                    />
                    <div className="text-[10px] text-gray-400">
                      {MONTHS[d.getMonth() + 1]} {d.getDate()}
                    </div>
                  </div>
                );
              })}
              {latestWeek && (
                <div className="ml-4 text-sm text-gray-500 self-center">
                  Latest: <b>{num(Number(latestWeek.total_units))}</b> units ·{" "}
                  <b>{rm(Number(latestWeek.inventory_value_myr))}</b> ·{" "}
                  {latestWeek.products_counted} products
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Grouped inventory */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Inventory by product range</CardTitle>
          <span className="text-xs text-gray-500">
            {num(totalStock)} units · AMS {num(totalAms)}/mo · click a range to expand
          </span>
        </CardHeader>
        <CardContent className="p-0">
          <GroupedInventory products={products} />
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  danger,
}: {
  label: string;
  value: string;
  sub?: string;
  danger?: boolean;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className={"text-2xl font-semibold mt-1 " + (danger ? "text-red-600" : "")}>
        {value}
      </div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}
