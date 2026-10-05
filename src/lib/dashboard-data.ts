import type { createClient } from "@/lib/supabase/server";
import type { ProductRow, IncomingBuckets } from "@/components/grouped-inventory";

// Shared by the Inventory Dashboard page and its Excel export so both read the
// exact same numbers (week selection, AMS window, incoming buckets, last-month
// sales, weighted turnover).

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const IDEAL_COVERAGE = 1.5;
export const OVER_COVERAGE = IDEAL_COVERAGE * 2;
export const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type WeekTurnover = { week: string; turnover: number | null };

export type DashboardData = {
  snapWeeks: string[];
  selWeek: string | null;
  isLatest: boolean;
  stockAsOf: string | null;
  amsEndMonth: number;
  amsEndYear: number;
  prevMonth: number;
  prevYear: number;
  incMonthLabels: [string, string, string, string];
  products: (ProductRow & Record<string, any>)[];
  incomingMap: Record<string, IncomingBuckets>;
  lastMonthSalesMap: Record<string, number>;
  inventoryValue: number;
  weightedTurnover: number | null;
  totalStock: number;
  totalAms: number;
  overallCoverage: number | null;
};

function weightedTurnoverOf(products: any[]): number | null {
  let num = 0;
  let den = 0;
  for (const p of products) {
    const cov = p.coverage_months;
    const w = Number(p.monthly_sales_value_myr || 0);
    if (cov != null && w > 0) {
      num += Number(cov) * w;
      den += w;
    }
  }
  return den > 0 ? num / den : null;
}

export async function loadDashboardData(
  supabase: Supabase,
  requestedWeek: string | undefined
): Promise<DashboardData> {
  // Available stock-upload weeks (distinct snapshot dates, KL tz) — the time axis.
  const { data: weekRows } = await supabase.from("stock_upload_weeks").select("snapshot_date");
  const snapWeeks = (weekRows ?? []).map((r) => r.snapshot_date as string);
  const latestSnapWeek = snapWeeks[snapWeeks.length - 1] ?? null;
  const selWeek = requestedWeek && snapWeeks.includes(requestedWeek) ? requestedWeek : latestSnapWeek;
  const isLatest = selWeek === latestSnapWeek;

  // AMS window = the 3 completed months BEFORE the stock month; label shows the window's end.
  const selDate = selWeek ? new Date(selWeek + "T00:00:00Z") : new Date();
  const selYear = selDate.getUTCFullYear();
  const selMonth = selDate.getUTCMonth() + 1;
  const amsEndMonth = selMonth === 1 ? 12 : selMonth - 1;
  const amsEndYear = selMonth === 1 ? selYear - 1 : selYear;

  // Today in Asia/Kuala_Lumpur for bucketing.
  const nowKL = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }));
  const curYear = nowKL.getFullYear();
  const curMonth = nowKL.getMonth() + 1;
  const prevMonth = curMonth === 1 ? 12 : curMonth - 1;
  const prevYear = curMonth === 1 ? curYear - 1 : curYear;

  // Labels for the incoming-arrival buckets: current month, +1, +2 (KL), with a
  // year suffix when the bucket rolls into a different year.
  const incMonthLabels = [
    ...[0, 1, 2].map((off) => {
      const base = curMonth - 1 + off;
      const y = curYear + Math.floor(base / 12);
      const m = (base % 12) + 1;
      return MONTHS[m] + (y !== curYear ? ` '${String(y).slice(2)}` : "");
    }),
    "Later",
  ] as [string, string, string, string];

  const [{ data: rows }, { data: incomingRows }, { data: lastMonthRows }] = await Promise.all([
    selWeek
      ? supabase.rpc("product_dashboard_asof_date", { p_date: selWeek })
      : Promise.resolve({ data: [] as any[] }),
    supabase
      .from("incoming_stock")
      .select("product_id, quantity, expected_date")
      .eq("status", "EXPECTED"),
    supabase
      .from("monthly_sales")
      .select("main_product_id, units_equivalent")
      .eq("year", prevYear)
      .eq("month", prevMonth),
  ]);

  const products = ((rows ?? []) as any[])
    .filter((p) => p.is_main && p.is_active)
    .sort((a, b) => Number(b.ams_total) - Number(a.ams_total));

  const incomingMap: Record<string, IncomingBuckets> = {};
  for (const row of incomingRows ?? []) {
    const d = new Date(row.expected_date);
    const monthsAhead = (d.getUTCFullYear() - curYear) * 12 + (d.getUTCMonth() + 1 - curMonth);
    // Past/current → this month; anything beyond +2 → "later" (not folded into +2,
    // which would make that column overstate a single month).
    const bucket: keyof IncomingBuckets =
      monthsAhead <= 0 ? "thisMonth" : monthsAhead === 1 ? "nextMonth" : monthsAhead === 2 ? "following" : "later";
    const pid = row.product_id;
    if (!incomingMap[pid]) incomingMap[pid] = { thisMonth: 0, nextMonth: 0, following: 0, later: 0 };
    incomingMap[pid][bucket] += Number(row.quantity || 0);
  }

  const lastMonthSalesMap: Record<string, number> = {};
  for (const row of lastMonthRows ?? []) {
    if (!row.main_product_id) continue;
    lastMonthSalesMap[row.main_product_id] =
      (lastMonthSalesMap[row.main_product_id] ?? 0) + Number(row.units_equivalent || 0);
  }

  // Format the date string directly — no TZ shift.
  const stockAsOf = selWeek
    ? (() => {
        const [y, m, d] = selWeek.split("-").map(Number);
        return `${d} ${MONTHS[m]} ${y}`;
      })()
    : null;

  const inventoryValue = products.reduce((s, p) => s + Number(p.inventory_value_myr || 0), 0);
  const totalStock = products.reduce((s, p) => s + Number(p.current_stock || 0), 0);
  const totalAms = products.reduce((s, p) => s + Number(p.ams_total || 0), 0);

  return {
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
    weightedTurnover: weightedTurnoverOf(products),
    totalStock,
    totalAms,
    overallCoverage: totalAms > 0 ? totalStock / totalAms : null,
  };
}

// Weighted turnover per stock week, for the trend chart / export.
export async function loadWeekTurnovers(supabase: Supabase, weeks: string[]): Promise<WeekTurnover[]> {
  return Promise.all(
    weeks.map(async (w) => {
      const { data } = await supabase.rpc("product_dashboard_asof_date", { p_date: w });
      const ps = ((data ?? []) as any[]).filter((p) => p.is_main && p.is_active);
      return { week: w, turnover: weightedTurnoverOf(ps) };
    })
  );
}
