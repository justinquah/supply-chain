import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GroupedInventory, type ProductRow, type IncomingBuckets } from "@/components/grouped-inventory";
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

/** Format a date like "11 May 2026" */
function fmtDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth() + 1]} ${d.getFullYear()}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  // SUPPLIER users have no inventory dashboard — send them to their portal.
  const me = await getCurrentUser();
  if (me?.role === "SUPPLIER") redirect("/supplier");
  // STAFF gets a restricted, value-free dashboard (no monetary figures).
  const canSeeValue = me?.role !== "STAFF";

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

  // Today in Asia/Kuala_Lumpur for bucketing
  const nowKL = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" })
  );
  const curYear = nowKL.getFullYear();
  const curMonth = nowKL.getMonth() + 1; // 1-based

  // Previous completed calendar month
  const prevMonth = curMonth === 1 ? 12 : curMonth - 1;
  const prevYear = curMonth === 1 ? curYear - 1 : curYear;

  // Labels for the 3 incoming-arrival buckets: current month, +1, +2 (KL), with a
  // year suffix when the bucket rolls into a different year.
  const incMonthLabels = [0, 1, 2].map((off) => {
    const base = curMonth - 1 + off;
    const y = curYear + Math.floor(base / 12);
    const m = (base % 12) + 1;
    return MONTHS[m] + (y !== curYear ? ` '${String(y).slice(2)}` : "");
  }) as [string, string, string];

  // Use the as-of function so AMS reflects the 3 months ending at the selected month
  const [
    { data: rows },
    { data: weekly },
    { data: incomingRows },
    { data: lastMonthRows },
    { data: stockDateRow },
  ] = await Promise.all([
    supabase.rpc("product_dashboard_asof", { p_year: selYear, p_month: selMonth }),
    supabase.from("inventory_weekly").select("*"),
    // Incoming stock bucketed (status=EXPECTED only)
    supabase
      .from("incoming_stock")
      .select("product_id, quantity, expected_date")
      .eq("status", "EXPECTED"),
    // Last completed calendar month sales
    supabase
      .from("monthly_sales")
      .select("main_product_id, units_equivalent")
      .eq("year", prevYear)
      .eq("month", prevMonth),
    // Latest stock snapshot date
    supabase
      .from("stock_snapshots")
      .select("recorded_at")
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const products = ((rows ?? []) as any[])
    .filter((p) => p.is_main && p.is_active)
    .sort((a, b) => Number(b.ams_total) - Number(a.ams_total)) as ProductRow[] & any[];

  // Build incoming buckets map: product_id → { thisMonth, nextMonth, following }
  const incomingMap: Record<string, IncomingBuckets> = {};
  for (const row of incomingRows ?? []) {
    const d = new Date(row.expected_date);
    const yr = d.getUTCFullYear();
    const mo = d.getUTCMonth() + 1; // 1-based

    // Determine bucket
    let bucket: keyof IncomingBuckets;
    const monthsAhead =
      (yr - curYear) * 12 + (mo - curMonth);
    if (monthsAhead <= 0) {
      // past or current month
      bucket = "thisMonth";
    } else if (monthsAhead === 1) {
      bucket = "nextMonth";
    } else {
      bucket = "following";
    }

    const pid = row.product_id;
    if (!incomingMap[pid]) {
      incomingMap[pid] = { thisMonth: 0, nextMonth: 0, following: 0 };
    }
    incomingMap[pid][bucket] += Number(row.quantity || 0);
  }

  // Build last-month sales map: product_id → total units_equivalent
  const lastMonthSalesMap: Record<string, number> = {};
  for (const row of lastMonthRows ?? []) {
    if (!row.main_product_id) continue;
    lastMonthSalesMap[row.main_product_id] =
      (lastMonthSalesMap[row.main_product_id] ?? 0) + Number(row.units_equivalent || 0);
  }

  // Latest stock snapshot date for display
  const stockAsOf: string | null = stockDateRow?.recorded_at
    ? fmtDate(new Date(stockDateRow.recorded_at))
    : null;

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
  // Overall coverage (value-free) = total stock units / total AMS — the "turnover"
  // figure STAFF can see in place of the value-weighted turnover.
  const overallCoverage = totalAms > 0 ? totalStock / totalAms : null;
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
            By product range · AMS = 3 months ending {MONTHS[selMonth]} {selYear}
            {canSeeValue && " · values in MYR"}
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
        {canSeeValue ? (
          <>
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
          </>
        ) : (
          <>
            <Kpi
              label="Total stock"
              value={num(totalStock)}
              sub="units on hand"
            />
            <Kpi
              label="Avg monthly sales"
              value={num(totalAms)}
              sub="units / month (3-mo)"
            />
            <Kpi
              label="Stock coverage"
              value={overallCoverage == null ? "—" : num(overallCoverage, 2) + " mo"}
              sub={`months of stock, target ${IDEAL}`}
              danger={overallCoverage != null && overallCoverage < IDEAL}
            />
          </>
        )}
        <Kpi
          label="Ranges below 1.5 mo"
          value={num(atRisk)}
          sub="products"
          danger={atRisk > 0}
        />
      </div>

      {/* Inventory health by week — value chart, hidden for STAFF */}
      {canSeeValue && (
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
      )}

      {/* Grouped inventory */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Inventory by product range</CardTitle>
          <span className="text-xs text-gray-500">
            {num(totalStock)} units · AMS {num(totalAms)}/mo ·{" "}
            {stockAsOf ? `Stock as of ${stockAsOf}` : "click a range to expand"}
          </span>
        </CardHeader>
        <CardContent className="p-0">
          {stockAsOf && (
            <p className="px-4 pt-3 pb-1 text-xs text-gray-400">
              Stock as of <span className="font-medium text-gray-600">{stockAsOf}</span>
              {" · "}Incoming bucketed by calendar month · Last mo = {MONTHS[prevMonth]} {prevYear}
            </p>
          )}
          <GroupedInventory
            products={products}
            incomingMap={incomingMap}
            lastMonthSalesMap={lastMonthSalesMap}
            hideValue={!canSeeValue}
            incomingMonthLabels={incMonthLabels}
          />
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
