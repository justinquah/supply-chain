import { createClient, requireRole } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { computeScmScore, computeStockScore } from "@/lib/scm-score";

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
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
function pct(v: number | null | undefined) {
  return v == null ? "—" : num(Number(v), 1) + "%";
}
function scoreColor(v: number) {
  return v >= 70 ? "text-emerald-600" : v >= 55 ? "text-amber-600" : "text-red-600";
}
function barColor(v: number) {
  return v >= 70 ? "bg-emerald-500" : v >= 55 ? "bg-amber-500" : "bg-red-500";
}
function gradeBadge(v: number) {
  return v >= 70 ? "bg-emerald-50 text-emerald-700" : v >= 55 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700";
}
type Status = "good" | "bad" | "warn" | "neutral";
function statusOver(v: number | null): Status {
  if (v == null) return "neutral";
  return v <= 20 ? "good" : v <= 40 ? "warn" : "bad";
}
function statusOos(v: number | null): Status {
  if (v == null) return "neutral";
  return v <= 5 ? "good" : v <= 10 ? "warn" : "bad";
}
function statusHealthy(v: number | null): Status {
  if (v == null) return "neutral";
  return v >= 60 ? "good" : v >= 40 ? "warn" : "bad";
}

type Grain = "month" | "quarter" | "fy";

export default async function KpiPage({
  searchParams,
}: {
  searchParams: Promise<{ g?: string; p?: string }>;
}) {
  // Internal-only: rejects STAFF and SUPPLIER.
  await requireRole("SCM", "ADMIN", "WAREHOUSE", "LOGISTICS");
  const supabase = await createClient();
  const sp = await searchParams;
  const grain: Grain =
    sp.g === "quarter" || sp.g === "fy" ? (sp.g as Grain) : "month";
  // Requested period within the grain (e.g. p=2026-5 for May 2026); defaults to latest.
  const periodParam = String(sp.p ?? "");

  const [
    { data: dash },
    { data: kMonthly },
    { data: kQuarterly },
    { data: kFy },
    { data: kWeekly },
    { data: kSnap },
    { data: incomingExp },
    { data: shippedPos },
  ] = await Promise.all([
    supabase.from("product_dashboard").select("*").eq("is_main", true).eq("is_active", true),
    supabase.from("kpi_monthly").select("*"),
    supabase.from("kpi_quarterly").select("*"),
    supabase.from("kpi_fy").select("*"),
    supabase.from("kpi_weekly").select("*"),
    supabase.from("kpi_snapshot").select("*"),
    supabase.from("incoming_stock").select("product_id").eq("status", "EXPECTED"),
    supabase
      .from("purchase_orders")
      .select("targeted_eta, supplier_eta, logistics_eta, eta_to_warehouse, actual_eta, eta_delayed")
      .eq("status", "SHIPPED"),
  ]);

  // ---- Stock Health KPI (Overstock % / OOS % / Healthy %) ----
  const kMonths = [...(kMonthly ?? [])].sort(
    (a: any, b: any) => a.cal_year - b.cal_year || a.cal_month - b.cal_month
  );
  const kQtrs = [...(kQuarterly ?? [])].sort(
    (a: any, b: any) => a.fy - b.fy || a.fy_q - b.fy_q
  );
  const kFys = [...(kFy ?? [])].sort((a: any, b: any) => a.fy - b.fy);

  // Selected period = the ?p= period if it exists for the grain, else the
  // latest available row. The KPI engine already aggregates weekly→monthly
  // (avg of the month's weekly uploads), monthly→quarterly (avg of monthly),
  // and monthly→FY (avg of monthly).
  const periodKey = (row: any): string =>
    grain === "month"
      ? `${row.cal_year}-${row.cal_month}`
      : grain === "quarter"
        ? `${row.fy}-${row.fy_q}`
        : `${row.fy}`;
  const periodLabel = (row: any): string =>
    grain === "month"
      ? `${MONTHS[row.cal_month]} ${row.cal_year}`
      : grain === "quarter"
        ? `Q${row.fy_q} ${row.fy_label}`
        : row.fy_label;
  const grainRows: any[] =
    grain === "month" ? kMonths : grain === "quarter" ? kQtrs : kFys;
  const periodOptions = grainRows.map((r) => ({
    key: periodKey(r),
    label: periodLabel(r),
  }));

  let selKpi: any = null;
  let selLabel = "—";
  if (grainRows.length) {
    selKpi =
      grainRows.find((r) => periodKey(r) === periodParam) ??
      grainRows[grainRows.length - 1];
    selLabel = periodLabel(selKpi);
  }
  const selKey = selKpi ? periodKey(selKpi) : "";

  // ---- Score trend WITHIN the selected period ----
  // Month view: one row per weekly upload; quarter/FY view: one row per month.
  // Stock pillars only (30/25/25 renormalised) — PO coordination has no history.
  const kWeeks = [...(kWeekly ?? [])].sort((a: any, b: any) =>
    String(a.week_start).localeCompare(String(b.week_start))
  );
  const fmtWeek = (iso: string) => {
    const [, m, d] = String(iso).split("-").map(Number);
    return `Week of ${d} ${MONTHS[m]}`;
  };
  type TrendRow = { label: string; score: number; oos: number; overstock: number; healthy: number };
  let scoreTrend: TrendRow[] = [];
  if (selKpi) {
    if (grain === "month") {
      scoreTrend = kWeeks
        .filter(
          (w: any) =>
            w.cal_year === selKpi.cal_year && w.cal_month === selKpi.cal_month
        )
        .map((w: any) => ({
          label: fmtWeek(w.week_start),
          score: computeStockScore(Number(w.oos_pct), Number(w.overstock_pct), Number(w.healthy_pct)),
          oos: Number(w.oos_pct),
          overstock: Number(w.overstock_pct),
          healthy: Number(w.healthy_pct),
        }));
    } else {
      scoreTrend = kMonths
        .filter((m: any) =>
          grain === "quarter"
            ? m.fy === selKpi.fy && m.fy_q === selKpi.fy_q
            : m.fy === selKpi.fy
        )
        .map((m: any) => ({
          label: `${MONTHS[m.cal_month]} ${m.cal_year}`,
          score: computeStockScore(Number(m.oos_pct), Number(m.overstock_pct), Number(m.healthy_pct)),
          oos: Number(m.oos_pct),
          overstock: Number(m.overstock_pct),
          healthy: Number(m.healthy_pct),
        }));
    }
  }

  // ---- SCM Performance Score (composite /100) — stock pillars from the SELECTED period ----
  const dashProducts = (dash ?? []) as any[];
  const incomingSet = new Set(((incomingExp ?? []) as any[]).map((r) => String(r.product_id)));
  const IDEAL_COV = 1.5;
  const lowStockProducts = dashProducts.filter(
    (p) => Number(p.ams_total) > 0 && p.coverage_months != null && Number(p.coverage_months) < IDEAL_COV
  );
  const lowStock = lowStockProducts.length;
  const lowNoPo = lowStockProducts.filter((p) => !incomingSet.has(String(p.id))).length;

  const nowKL = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }));
  const todayISO = `${nowKL.getFullYear()}-${String(nowKL.getMonth() + 1).padStart(2, "0")}-${String(nowKL.getDate()).padStart(2, "0")}`;
  const currentEta = (po: any) =>
    po.eta_to_warehouse || po.actual_eta || po.logistics_eta || po.supplier_eta || po.targeted_eta || null;
  let overdue = 0;
  let overdueManaged = 0;
  for (const po of (shippedPos ?? []) as any[]) {
    const eta = currentEta(po);
    if (eta && String(eta) < todayISO) {
      overdue++;
      if (po.eta_delayed) overdueManaged++;
    }
  }

  const scm = computeScmScore({
    oosPct: selKpi?.oos_pct != null ? Number(selKpi.oos_pct) : null,
    overstockPct: selKpi?.overstock_pct != null ? Number(selKpi.overstock_pct) : null,
    healthyPct: selKpi?.healthy_pct != null ? Number(selKpi.healthy_pct) : null,
    lowStock,
    lowNoPo,
    overdue,
    overdueManaged,
  });

  // Drill-down: latest week's eligible classification.
  const snaps = kSnap ?? [];
  const latestWeek = snaps.reduce(
    (mx: string | null, s: any) => (mx == null || s.week_start > mx ? s.week_start : mx),
    null as string | null
  );
  const latestRows = snaps.filter(
    (s: any) => s.week_start === latestWeek && s.eligible
  );
  const oosList = latestRows
    .filter((s: any) => s.klass === "OOS")
    .sort((a: any, b: any) => a.sku.localeCompare(b.sku));
  const overList = latestRows
    .filter((s: any) => s.klass === "OVERSTOCK")
    .sort((a: any, b: any) => Number(b.stock) - Number(a.stock));

  const products = dash ?? [];

  // Current-position KPIs (latest snapshot)
  const invValue = products.reduce((s, p) => s + Number(p.inventory_value_myr || 0), 0);
  const monthlySalesValue = products.reduce(
    (s, p) => s + Number(p.monthly_sales_value_myr || 0),
    0
  );
  let wNum = 0, wDen = 0;
  for (const p of products) {
    const cov = p.coverage_months;
    const w = Number(p.monthly_sales_value_myr || 0);
    if (cov != null && w > 0) {
      wNum += Number(cov) * w;
      wDen += w;
    }
  }
  const weightedTurnover = wDen > 0 ? wNum / wDen : null;
  const selling = products.filter((p) => Number(p.ams_total) > 0);
  const below = selling.filter(
    (p) => p.coverage_months != null && Number(p.coverage_months) < IDEAL
  ).length;
  const over = selling.filter(
    (p) => p.coverage_months != null && Number(p.coverage_months) > IDEAL * 2
  ).length;
  const healthy = selling.length - below - over;
  const healthyPct = selling.length ? (healthy / selling.length) * 100 : 0;

  // Months-of-inventory-cost ratio (capital efficiency): inventory value / monthly sales value
  const monthsOfCapital = monthlySalesValue > 0 ? invValue / monthlySalesValue : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Supply Chain KPIs</h1>
        <p className="text-sm text-gray-500 mt-1">
          Scorecard for the Supply Chain Manager · target coverage {IDEAL} months
        </p>
      </div>

      {/* ============ SCM performance score (composite /100) ============ */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle>SCM performance score</CardTitle>
            <p className="text-xs text-gray-500 mt-1">
              Availability · Stock health · Capital efficiency · PO coordination · {selLabel}
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1 text-sm">
            {(["month", "quarter", "fy"] as Grain[]).map((g) => (
              <a
                key={g}
                href={`/kpi?g=${g}`}
                className={
                  "px-3 py-1 rounded-md capitalize " +
                  (grain === g
                    ? "bg-white shadow-sm font-medium text-gray-900"
                    : "text-gray-500 hover:text-gray-800")
                }
              >
                {g === "fy" ? "FY" : g}
              </a>
            ))}
          </div>
          {/* Period picker within the grain — view any past month/quarter, not just the latest. */}
          {periodOptions.length > 1 && (
            <div className="w-full flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] text-gray-400 mr-1">View:</span>
              {periodOptions.map((o) => (
                <a
                  key={o.key}
                  href={`/kpi?g=${grain}&p=${o.key}`}
                  className={
                    "px-2 py-0.5 rounded-full text-xs border " +
                    (o.key === selKey
                      ? "bg-gray-900 text-white border-gray-900 font-medium"
                      : "bg-white text-gray-600 border-gray-200 hover:border-gray-400")
                  }
                >
                  {o.label}
                </a>
              ))}
            </div>
          )}
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6 flex-wrap">
            <div className="text-center shrink-0">
              <div className={"text-5xl font-bold " + scoreColor(scm.total)}>{Math.round(scm.total)}</div>
              <div className="text-[11px] text-gray-400">out of 100</div>
              <div className={"mt-1 inline-block px-2 py-0.5 rounded text-xs font-semibold " + gradeBadge(scm.total)}>
                {scm.grade} · {scm.gradeLabel}
              </div>
            </div>
            <div className="flex-1 min-w-[280px] space-y-2.5">
              {scm.pillars.map((p) => (
                <div key={p.key}>
                  <div className="flex items-center justify-between text-xs gap-2">
                    <span className="text-gray-700 font-medium whitespace-nowrap">
                      {p.label} <span className="text-gray-400 font-normal">· {p.weight}%</span>
                    </span>
                    <span className="text-gray-500 text-right truncate">
                      {p.metric} → <b className={scoreColor(p.score)}>{Math.round(p.score)}</b>
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded mt-1 overflow-hidden">
                    <div
                      className={"h-full rounded " + barColor(p.score)}
                      style={{ width: `${Math.round(p.score)}%` }}
                    />
                  </div>
                  {/* Why the score is what it is, in the period's own numbers. */}
                  <p className="text-[11px] text-gray-500 mt-1">{p.why}</p>
                  {p.actions.length > 0 && (
                    <details className="mt-0.5">
                      <summary className="text-[11px] text-sky-700 cursor-pointer select-none">
                        How to improve
                      </summary>
                      <ul className="mt-1 space-y-0.5 text-[11px] text-gray-600 list-disc pl-4">
                        {p.actions.map((a) => (
                          <li key={a}>{a}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </div>
          {/* Score trend within the period — weekly rows in Month view, monthly
              rows in Quarter/FY view — so the SCM can review week by week. */}
          {scoreTrend.length > 0 && (
            <div className="mt-4 border-t border-gray-100 pt-3">
              <div className="text-xs font-semibold text-gray-700 mb-2">
                {grain === "month" ? "Score by week" : "Score by month"} · {selLabel}
                <span className="text-gray-400 font-normal">
                  {" "}
                  · stock pillars only — PO coordination is current-state and has no history
                </span>
              </div>
              <div className="space-y-1.5">
                {scoreTrend.map((t, idx) => {
                  const prev = idx > 0 ? scoreTrend[idx - 1].score : null;
                  const delta = prev != null ? Math.round(t.score) - Math.round(prev) : null;
                  return (
                    <div key={t.label} className="flex items-center gap-3 text-xs">
                      <span className="w-28 shrink-0 text-gray-600">{t.label}</span>
                      <div className="flex-1 h-1.5 bg-gray-100 rounded overflow-hidden">
                        <div
                          className={"h-full rounded " + barColor(t.score)}
                          style={{ width: `${Math.round(t.score)}%` }}
                        />
                      </div>
                      <b className={"w-7 text-right " + scoreColor(t.score)}>
                        {Math.round(t.score)}
                      </b>
                      <span
                        className={
                          "w-10 text-right " +
                          (delta == null
                            ? "text-gray-300"
                            : delta > 0
                              ? "text-emerald-600"
                              : delta < 0
                                ? "text-red-600"
                                : "text-gray-400")
                        }
                      >
                        {delta == null ? "—" : delta > 0 ? `▲ ${delta}` : delta < 0 ? `▼ ${Math.abs(delta)}` : "＝"}
                      </span>
                      <span className="hidden sm:block w-56 text-right text-gray-400">
                        OOS {t.oos.toFixed(1)}% · Over {t.overstock.toFixed(1)}% · Healthy {t.healthy.toFixed(1)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <p className="text-[11px] text-gray-400 mt-3">
            Stock pillars = the {grain === "month" ? "month's" : grain === "quarter" ? "quarter's" : "FY's"} KPI
            (month = avg of weekly uploads · quarter/FY = avg of monthly). PO coordination = reorder
            discipline + managing overdue POs (ETA updated / flagged Delayed), shown at current state —
            not delivery delays outside the SCM&apos;s control.
          </p>
        </CardContent>
      </Card>

      {/* ============ Stock Health KPI (the locked KPI) ============ */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle>Stock Health — Overstock / OOS / Healthy</CardTitle>
            <p className="text-xs text-gray-500 mt-1">
              Eligible SKUs classified each weekly snapshot · OOS = 0 · Overstock &gt;
              2×AMS(3-mo) · {selKpi ? `showing ${selLabel}` : "no data yet"}
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1 text-sm">
            {(["month", "quarter", "fy"] as Grain[]).map((g) => (
              <a
                key={g}
                href={`/kpi?g=${g}`}
                className={
                  "px-3 py-1 rounded-md capitalize " +
                  (grain === g
                    ? "bg-white shadow-sm font-medium text-gray-900"
                    : "text-gray-500 hover:text-gray-800")
                }
              >
                {g === "fy" ? "FY" : g}
              </a>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {selKpi ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Score
                  label="Overstock %"
                  value={pct(selKpi.overstock_pct)}
                  target="required ≤ 20% · stock > 2× AMS(3-mo)"
                  status={statusOver(selKpi.overstock_pct)}
                />
                <Score
                  label="Out of stock %"
                  value={pct(selKpi.oos_pct)}
                  target="required 0% · stock = 0"
                  status={statusOos(selKpi.oos_pct)}
                />
                <Score
                  label="Healthy %"
                  value={pct(selKpi.healthy_pct)}
                  target="required ≥ 80% · 0 < stock ≤ 2× AMS"
                  status={statusHealthy(selKpi.healthy_pct)}
                />
              </div>

              {/* Monthly trend of the three % */}
              {kMonths.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 border-b border-gray-200">
                        <th className="py-2 pr-3 font-medium">KPI</th>
                        {kMonths.map((m: any) => (
                          <th
                            key={`${m.cal_year}-${m.cal_month}`}
                            className="py-2 px-3 font-medium text-right whitespace-nowrap"
                          >
                            {MONTHS[m.cal_month]} {String(m.cal_year).slice(2)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <KpiRow
                        label="Overstock %"
                        values={kMonths.map((m: any) => pct(m.overstock_pct))}
                        bold
                      />
                      <KpiRow
                        label="Out of stock %"
                        values={kMonths.map((m: any) => pct(m.oos_pct))}
                      />
                      <KpiRow
                        label="Healthy %"
                        values={kMonths.map((m: any) => pct(m.healthy_pct))}
                      />
                      <KpiRow
                        label="Eligible SKUs"
                        values={kMonths.map((m: any) => num(Number(m.eligible_n || 0)))}
                        muted
                      />
                    </tbody>
                  </table>
                </div>
              )}

              {/* Drill-down: current problem SKUs */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <DrillList
                  title={`Out of stock now (${oosList.length})`}
                  tone="bad"
                  rows={oosList.map((s: any) => ({
                    sku: s.sku,
                    right: "0 in stock",
                  }))}
                  empty="None — nothing at zero."
                />
                <DrillList
                  title={`Overstocked now (${overList.length})`}
                  tone="warn"
                  rows={overList.slice(0, 12).map((s: any) => {
                    const ams = Number(s.ams_3mo);
                    const cover = ams > 0 ? num(Number(s.stock) / ams, 1) + " mo" : "no sales";
                    return {
                      sku: s.sku,
                      right: `${num(Number(s.stock))} u · ${cover}`,
                    };
                  })}
                  empty="None over 2× AMS."
                />
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-500 py-4">
              No KPI data yet for this view. The KPI populates once a weekly stock
              snapshot and the prior 3 months of sales are present.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ============ Capital efficiency — cash tied in stock vs target ============ */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700">Capital efficiency</h2>
        <p className="text-[11px] text-gray-400">
          How hard the inventory money is working — required: coverage near {IDEAL} months, not under, not far over.
        </p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Score
          label="Weighted turnover"
          value={weightedTurnover == null ? "—" : num(weightedTurnover, 2) + " mo"}
          target={`target ${IDEAL} mo`}
          status={
            weightedTurnover == null
              ? "neutral"
              : weightedTurnover < IDEAL
              ? "bad"
              : weightedTurnover > IDEAL * 2
              ? "warn"
              : "good"
          }
        />
        <Score
          label="Inventory value"
          value={rm(invValue)}
          target="capital tied in stock"
          status="neutral"
        />
        <Score
          label="Capital cover"
          value={monthsOfCapital == null ? "—" : num(monthsOfCapital, 2) + " mo"}
          target="inv value ÷ monthly COGS"
          status="neutral"
        />
        <Score
          label="Ranges on target"
          value={num(healthyPct, 0) + "%"}
          target={`${healthy}/${selling.length} between ${IDEAL}–${IDEAL * 2} mo`}
          status={healthyPct >= 60 ? "good" : healthyPct >= 40 ? "warn" : "bad"}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <MiniStat label="Understocked (<1.5 mo)" value={below} danger />
        <MiniStat label="Healthy" value={healthy} good />
        <MiniStat label="Overstocked (>3 mo)" value={over} warn />
      </div>

      {/* Sales reporting deliberately does NOT live here — the KPI tab measures
          what the SCM controls (availability + capital efficiency). Units sold
          and sales value are on the Sales / Sales Trend tabs. */}
    </div>
  );
}

function Score({
  label,
  value,
  target,
  status,
}: {
  label: string;
  value: string;
  target: string;
  status: "good" | "bad" | "warn" | "neutral";
}) {
  const color =
    status === "good"
      ? "text-emerald-700"
      : status === "bad"
      ? "text-red-600"
      : status === "warn"
      ? "text-amber-600"
      : "text-gray-900";
  const dot =
    status === "good"
      ? "bg-emerald-500"
      : status === "bad"
      ? "bg-red-500"
      : status === "warn"
      ? "bg-amber-500"
      : "bg-gray-300";
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center gap-1.5">
        <span className={"h-2 w-2 rounded-full " + dot} />
        <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      </div>
      <div className={"text-2xl font-semibold mt-1 " + color}>{value}</div>
      <div className="text-xs text-gray-400 mt-0.5">{target}</div>
    </div>
  );
}

function DrillList({
  title,
  tone,
  rows,
  empty,
}: {
  title: string;
  tone: "bad" | "warn";
  rows: { sku: string; right: string }[];
  empty: string;
}) {
  const dot = tone === "bad" ? "bg-red-500" : "bg-amber-500";
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <span className={"h-2 w-2 rounded-full " + dot} />
        <div className="text-sm font-medium text-gray-800">{title}</div>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-400 py-1">{empty}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((r) => (
            <li key={r.sku} className="flex items-center justify-between py-1.5 text-sm">
              <span className="text-gray-700 font-mono text-xs">{r.sku}</span>
              <span className="text-gray-500 tabular-nums text-xs">{r.right}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MiniStat({
  label,
  value,
  danger,
  good,
  warn,
}: {
  label: string;
  value: number;
  danger?: boolean;
  good?: boolean;
  warn?: boolean;
}) {
  const color = danger
    ? "text-red-600"
    : good
    ? "text-emerald-700"
    : warn
    ? "text-amber-600"
    : "text-gray-900";
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={"text-xl font-semibold mt-0.5 " + color}>{value}</div>
    </div>
  );
}

function KpiRow({
  label,
  values,
  bold,
  muted,
}: {
  label: string;
  values: string[];
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <tr className="border-b border-gray-100">
      <td
        className={
          "py-2 pr-3 " +
          (bold ? "font-medium text-gray-900" : muted ? "text-gray-400 pl-3" : "text-gray-700")
        }
      >
        {label}
      </td>
      {values.map((v, i) => (
        <td
          key={i}
          className={
            "py-2 px-3 text-right tabular-nums " +
            (bold ? "font-medium" : muted ? "text-gray-400" : "text-gray-600")
          }
        >
          {v}
        </td>
      ))}
    </tr>
  );
}
