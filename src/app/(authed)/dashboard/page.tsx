import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GroupedInventory } from "@/components/grouped-inventory";
import { WeekSelector } from "@/components/week-selector";
import {
  IDEAL_COVERAGE as IDEAL,
  OVER_COVERAGE as OVER,
  MONTHS,
  loadDashboardData,
  loadWeekTurnovers,
} from "@/lib/dashboard-data";

function rm(v: number) {
  return "RM " + Math.round(v).toLocaleString("en-MY");
}
function num(v: number, dp = 0) {
  return Number(v).toLocaleString("en-MY", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ w?: string }>;
}) {
  // SUPPLIER users have no inventory dashboard — send them to their portal.
  const me = await getCurrentUser();
  if (me?.role === "SUPPLIER") redirect("/supplier");
  // Finance tier (Finance/Accounts) sees only Finance, PO & Invoices, Products —
  // their home is the Finance page, not the operations dashboard.
  if (me?.role === "FINANCE" || me?.role === "ACCOUNTS") redirect("/finance");
  // STAFF gets a restricted, value-free dashboard (no monetary figures).
  const canSeeValue = me?.role !== "STAFF";

  const supabase = await createClient();
  const sp = await searchParams;

  const {
    snapWeeks,
    selWeek,
    isLatest,
    stockAsOf,
    amsEndMonth,
    amsEndYear,
    prevMonth,
    prevYear,
    incMonthLabels,
    products,
    incomingMap,
    lastMonthSalesMap,
    inventoryValue,
    weightedTurnover,
    totalStock,
    totalAms,
    overallCoverage,
  } = await loadDashboardData(supabase, sp.w);

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
  const weekTurnovers = await loadWeekTurnovers(supabase, snapWeeks);

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
        <div className="flex items-center gap-2">
          {snapWeeks.length > 0 && selWeek && (
            <WeekSelector weeks={snapWeeks} selected={selWeek} />
          )}
          {selWeek && (
            <a
              href={`/dashboard/export?w=${selWeek}`}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              title="Download this week's dashboard (turnover by week + inventory by range) as Excel"
            >
              <svg
                className="h-4 w-4 text-emerald-700"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M4 4h12l4 4v12H4z" />
                <path d="M16 4v4h4" />
                <path d="M9 13l3 3 3-3M12 9v7" />
              </svg>
              Export Excel
            </a>
          )}
        </div>
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
