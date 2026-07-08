import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GroupedInventory, type ProductRow, type IncomingBuckets } from "@/components/grouped-inventory";
import { WeekSelector } from "@/components/week-selector";

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
  searchParams: Promise<{ w?: string }>;
}) {
  // SUPPLIER users have no inventory dashboard — send them to their portal.
  const me = await getCurrentUser();
  if (me?.role === "SUPPLIER") redirect("/supplier");
  // STAFF gets a restricted, value-free dashboard (no monetary figures).
  const canSeeValue = me?.role !== "STAFF";

  const supabase = await createClient();
  const sp = await searchParams;

  // Available stock-upload weeks (distinct snapshot dates, KL tz) — the dashboard's time axis.
  const { data: weekRows } = await supabase
    .from("stock_upload_weeks")
    .select("snapshot_date");
  const snapWeeks = (weekRows ?? []).map((r) => r.snapshot_date as string);
  const latestSnapWeek = snapWeeks[snapWeeks.length - 1] ?? null;
  const selWeek =
    sp.w && snapWeeks.includes(sp.w) ? sp.w : latestSnapWeek;
  const isLatest = selWeek === latestSnapWeek;
  // AMS window = the calendar month of the selected stock week.
  const selDate = selWeek ? new Date(selWeek + "T00:00:00Z") : new Date();
  const selYear = selDate.getUTCFullYear();
  const selMonth = selDate.getUTCMonth() + 1;
  // AMS window = the 3 completed months BEFORE the stock month; label shows the window's end.
  const amsEndMonth = selMonth === 1 ? 12 : selMonth - 1;
  const amsEndYear = selMonth === 1 ? selYear - 1 : selYear;

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
  ] = await Promise.all([
    selWeek
      ? supabase.rpc("product_dashboard_asof_date", { p_date: selWeek })
      : Promise.resolve({ data: [] as any[] }),
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

  // The selected stock-upload week, for display (format the date string directly, no TZ shift).
  const stockAsOf: string | null = selWeek
    ? (() => {
        const [y, m, d] = selWeek.split("-").map(Number);
        return `${d} ${MONTHS[m]} ${y}`;
      })()
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

  // Action lists: what to replenish (below target) vs push (overstock).
  const OVER = IDEAL * 2; // 3.0 mo = clearly overstocked
  const understock = products
    .filter((p) => p.ams_total > 0 && p.coverage_months != null && Number(p.coverage_months) < IDEAL)
    .sort((a, b) => Number(a.coverage_months) - Number(b.coverage_months));
  const overstock = products
    .filter((p) => p.ams_total > 0 && p.coverage_months != null && Number(p.coverage_months) > OVER)
    .sort((a, b) => Number(b.coverage_months) - Number(a.coverage_months));

  // Weighted-turnover status (target IDEAL): red when clearly over/under.
  const turnoverOver = weightedTurnover != null && weightedTurnover > OVER;
  const turnoverUnder = weightedTurnover != null && weightedTurnover < IDEAL * 0.75;
  const turnoverDanger = turnoverOver || turnoverUnder;
  const turnoverSub = turnoverOver
    ? `target ${IDEAL} mo · overstocked`
    : turnoverUnder
    ? `target ${IDEAL} mo · below target`
    : `target ${IDEAL} mo · on track`;

  // Weighted turnover per stock week, to show the trend toward target.
  const weekTurnovers = await Promise.all(
    snapWeeks.map(async (w) => {
      const { data } = await supabase.rpc("product_dashboard_asof_date", { p_date: w });
      const ps = ((data ?? []) as any[]).filter((p) => p.is_main && p.is_active);
      let n = 0,
        dn = 0;
      for (const p of ps) {
        const c = p.coverage_months;
        const sv = Number(p.monthly_sales_value_myr || 0);
        if (c != null && sv > 0) {
          n += Number(c) * sv;
          dn += sv;
        }
      }
      return { week: w, turnover: dn > 0 ? n / dn : null };
    })
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Inventory Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            By product range · stock as of {stockAsOf ?? "—"} · AMS = 3 months ending{" "}
            {MONTHS[amsEndMonth]} {amsEndYear}
            {canSeeValue && " · values in MYR"}
            {!isLatest && (
              <span className="ml-2 text-amber-600">
                (viewing an earlier week)
              </span>
            )}
          </p>
        </div>
        {snapWeeks.length > 0 && selWeek && (
          <WeekSelector weeks={snapWeeks} selected={selWeek} />
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
              sub={turnoverSub}
              danger={turnoverDanger}
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

      {/* Action lists: replenish (below target) vs push sales (overstock) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ActionList
          title={`Replenish — below ${IDEAL} mo (${understock.length})`}
          tone="bad"
          hint="running low · order / expedite"
          rows={understock.map((p) => ({
            sku: p.sku,
            right: `${num(Number(p.coverage_months), 1)} mo · ${num(Number(p.current_stock))} u`,
          }))}
          empty="Nothing below target."
        />
        <ActionList
          title={`Push sales — overstock > ${OVER} mo (${overstock.length})`}
          tone="warn"
          hint="excess stock · promote / push harder"
          rows={overstock.map((p) => ({
            sku: p.sku,
            right: `${num(Number(p.coverage_months), 1)} mo · ${num(Number(p.current_stock))} u`,
          }))}
          empty="No ranges heavily overstocked."
        />
      </div>

      {/* Weighted turnover by week — progress toward target */}
      {canSeeValue && weekTurnovers.some((w) => w.turnover != null) && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Weighted turnover by week</CardTitle>
            <span className="text-xs text-gray-500">target {IDEAL} mo</span>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-4 flex-wrap">
              {weekTurnovers.map((w) => {
                const t = w.turnover;
                const maxT = Math.max(IDEAL * 2, ...weekTurnovers.map((x) => x.turnover ?? 0));
                const h = t != null && maxT > 0 ? (t / maxT) * 80 : 0;
                const off = t != null && (t > OVER || t < IDEAL * 0.75);
                const [y, m, d] = w.week.split("-").map(Number);
                return (
                  <div key={w.week} className="flex flex-col items-center gap-1">
                    <div className={"text-xs tabular-nums " + (off ? "text-red-600 font-medium" : "text-gray-600")}>
                      {t == null ? "—" : num(t, 2) + " mo"}
                    </div>
                    <div
                      className={"w-12 rounded-t " + (off ? "bg-red-500" : "bg-emerald-500")}
                      style={{ height: `${Math.max(h, 4)}px` }}
                    />
                    <div className="text-[10px] text-gray-400">{MONTHS[m]} {d}</div>
                  </div>
                );
              })}
              <div className="ml-4 text-sm text-gray-500 self-center">
                Green = near target ({IDEAL} mo) · Red = over/under. Lower &amp; steadier is better.
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Inventory level by week — value chart, hidden for STAFF */}
      {canSeeValue && (
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Inventory level by week</CardTitle>
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

function ActionList({
  title,
  tone,
  hint,
  rows,
  empty,
}: {
  title: string;
  tone: "bad" | "warn";
  hint: string;
  rows: { sku: string; right: string }[];
  empty: string;
}) {
  const dot = tone === "bad" ? "bg-red-500" : "bg-amber-500";
  const edge = tone === "bad" ? "border-l-red-400" : "border-l-amber-400";
  return (
    <div className={"rounded-lg border border-gray-200 border-l-4 p-3 " + edge}>
      <div className="flex items-center gap-1.5">
        <span className={"h-2 w-2 rounded-full " + dot} />
        <div className="text-sm font-medium text-gray-800">{title}</div>
      </div>
      <div className="text-[11px] text-gray-400 mb-2 ml-3.5">{hint}</div>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-400 py-1">{empty}</p>
      ) : (
        <ul className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.sku} className="flex items-center justify-between py-1.5 text-sm gap-3">
              <span className="text-gray-700 font-mono text-xs truncate">{r.sku}</span>
              <span className="text-gray-500 tabular-nums text-xs whitespace-nowrap">{r.right}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
