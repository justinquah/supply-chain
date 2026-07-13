import { createClient, requireRole } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { computeScmScore } from "@/lib/scm-score";

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
  searchParams: Promise<{ g?: string }>;
}) {
  // Internal-only: rejects STAFF and SUPPLIER.
  await requireRole("SCM", "ADMIN", "ACCOUNTS", "FINANCE", "WAREHOUSE", "LOGISTICS");
  const supabase = await createClient();
  const sp = await searchParams;
  const grain: Grain =
    sp.g === "quarter" || sp.g === "fy" ? (sp.g as Grain) : "month";

  const [
    { data: monthly },
    { data: dash },
    { data: weekly },
    { data: kMonthly },
    { data: kQuarterly },
    { data: kFy },
    { data: kSnap },
    { data: incomingExp },
    { data: shippedPos },
  ] = await Promise.all([
    supabase.from("monthly_kpi").select("*"),
    supabase.from("product_dashboard").select("*").eq("is_main", true).eq("is_active", true),
    supabase.from("inventory_weekly").select("*"),
    supabase.from("kpi_monthly").select("*"),
    supabase.from("kpi_quarterly").select("*"),
    supabase.from("kpi_fy").select("*"),
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

  // ---- SCM Performance Score (composite, out of 100) ----
  const latestKpiMonth = kMonths.length ? kMonths[kMonths.length - 1] : null;
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
    oosPct: latestKpiMonth?.oos_pct != null ? Number(latestKpiMonth.oos_pct) : null,
    overstockPct: latestKpiMonth?.overstock_pct != null ? Number(latestKpiMonth.overstock_pct) : null,
    healthyPct: latestKpiMonth?.healthy_pct != null ? Number(latestKpiMonth.healthy_pct) : null,
    lowStock,
    lowNoPo,
    overdue,
    overdueManaged,
  });
  const scmMonthLabel = latestKpiMonth ? `${MONTHS[latestKpiMonth.cal_month]} ${latestKpiMonth.cal_year}` : "—";

  // Selected period = latest available row for the chosen grain.
  let selKpi: any = null;
  let selLabel = "—";
  if (grain === "month" && kMonths.length) {
    selKpi = kMonths[kMonths.length - 1];
    selLabel = `${MONTHS[selKpi.cal_month]} ${selKpi.cal_year}`;
  } else if (grain === "quarter" && kQtrs.length) {
    selKpi = kQtrs[kQtrs.length - 1];
    selLabel = `Q${selKpi.fy_q} ${selKpi.fy_label}`;
  } else if (grain === "fy" && kFys.length) {
    selKpi = kFys[kFys.length - 1];
    selLabel = selKpi.fy_label;
  }

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

  const months = monthly ?? [];
  const products = dash ?? [];

  // Trailing-3-month AMS per month (units) for trend
  const amsByMonth = months.map((m: any, i: number) => {
    const window = months.slice(Math.max(0, i - 2), i + 1);
    const avg =
      window.reduce((s: number, x: any) => s + Number(x.units_total), 0) /
      Math.min(3, window.length);
    return { year: m.year, month: m.month, ams: avg };
  });

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
              Availability · Stock health · Capital efficiency · PO coordination · {scmMonthLabel}
            </p>
          </div>
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
                </div>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-gray-400 mt-3">
            PO coordination = reorder discipline + managing overdue POs (ETA updated / flagged
            Delayed) — not delivery delays outside the SCM&apos;s control. Improves as data is
            cleaned and POs are received in-app.
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
                  target="stock > 2× AMS(3-mo)"
                  status={statusOver(selKpi.overstock_pct)}
                />
                <Score
                  label="Out of stock %"
                  value={pct(selKpi.oos_pct)}
                  target="stock = 0"
                  status={statusOos(selKpi.oos_pct)}
                />
                <Score
                  label="Healthy %"
                  value={pct(selKpi.healthy_pct)}
                  target="0 < stock ≤ 2× AMS"
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

      {/* Current position scorecard */}
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

      {/* Monthly results table */}
      <Card>
        <CardHeader>
          <CardTitle>Results by month</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-3 font-medium">KPI</th>
                  {months.map((m: any) => (
                    <th
                      key={`${m.year}-${m.month}`}
                      className="py-2 px-3 font-medium text-right whitespace-nowrap"
                    >
                      {MONTHS[m.month]} {String(m.year).slice(2)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <KpiRow
                  label="Units sold — total"
                  values={months.map((m: any) => num(Number(m.units_total)))}
                  bold
                />
                <KpiRow
                  label="— online"
                  values={months.map((m: any) => num(Number(m.units_online || 0)))}
                  muted
                />
                <KpiRow
                  label="— offline"
                  values={months.map((m: any) => num(Number(m.units_offline || 0)))}
                  muted
                />
                <KpiRow
                  label="AMS (trailing 3 mo)"
                  values={amsByMonth.map((a) => num(a.ams))}
                />
                <KpiRow
                  label="Sales value (at cost)"
                  values={months.map((m: any) => rm(Number(m.sales_value_myr || 0)))}
                  bold
                />
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            Inventory value & turnover by month build up as you upload stock weekly
            (currently {weekly?.length ?? 0} week
            {(weekly?.length ?? 0) === 1 ? "" : "s"} of stock history).
          </p>
        </CardContent>
      </Card>
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
