import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

export default async function KpiPage() {
  const supabase = await createClient();

  const [{ data: monthly }, { data: dash }, { data: weekly }] = await Promise.all([
    supabase.from("monthly_kpi").select("*"),
    supabase.from("product_dashboard").select("*").eq("is_main", true).eq("is_active", true),
    supabase.from("inventory_weekly").select("*"),
  ]);

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
