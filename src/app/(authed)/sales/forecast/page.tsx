import Link from "next/link";
import { createClient, requireRole } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ForecastTable, type ForecastTableRow } from "@/components/forecast-table";
import { loadForecastData } from "@/lib/forecast-store";
import { parseTargetMonth, TargetsView } from "./targets-view";
import {
  fromMonthIndex,
  METHOD_LABELS,
  monthIndex,
  summarizeAccuracy,
  type AccuracySummary,
  type ForecastChannel,
} from "@/lib/forecast";
import { cn } from "@/lib/utils";

type Channel = "total" | "online" | "offline";
const CHANNEL_LABELS: Record<Channel, string> = {
  total: "Total",
  online: "Online",
  offline: "Offline",
};
function parseChannel(c: string | undefined): Channel {
  if (c === "online" || c === "offline") return c;
  return "total";
}

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (idx: number) => {
  const t = fromMonthIndex(idx);
  return `${MONTHS[t.month]} ${t.year}`;
};
const short = (idx: number) => {
  const t = fromMonthIndex(idx);
  return `${MONTHS[t.month]} ’${String(t.year).slice(-2)}`;
};
const n = (v: number) => Math.round(v).toLocaleString("en-MY");
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const signedPct = (v: number | null) =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`;

const EVAL_WINDOW = 6; // months averaged in the accuracy summary

export default async function SalesForecastPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; view?: string; m?: string }>;
}) {
  await requireRole("SCM", "ADMIN");
  const supabase = await createClient();
  const sp = await searchParams;
  const view = sp.view === "targets" ? "targets" : "forecast";
  const channel = parseChannel(sp.c);
  const inScope = (ch: ForecastChannel) =>
    channel === "total" || (channel === "online" ? ch === "ONLINE" : ch === "OFFLINE");

  const data = await loadForecastData(supabase, { canWrite: true });
  const { products, points, complete, latestBase, live, saved, saveError } = data;

  const viewTabs = (
    <div className="flex items-center gap-1 border-b border-gray-200">
      {(
        [
          ["forecast", "Forecast", "/sales/forecast"],
          ["targets", "Targets", "/sales/forecast?view=targets"],
        ] as const
      ).map(([v, lbl, href]) => (
        <Link
          key={v}
          href={href}
          className={cn(
            "px-4 py-2 -mb-px text-sm font-medium border-b-2 transition-colors",
            view === v
              ? "border-brand text-brand"
              : "border-transparent text-gray-500 hover:text-gray-800"
          )}
        >
          {lbl}
        </Link>
      ))}
    </div>
  );

  if (view === "targets") {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-semibold">Forecast &amp; Target</h1>
          <p className="text-sm text-gray-500 mt-1">
            Monthly units targets by channel and for focus products — compared with the forecast
            until the month&rsquo;s sales are uploaded, then with the actual.
          </p>
        </div>
        {viewTabs}
        <TargetsView
          supabase={supabase}
          data={data}
          requested={parseTargetMonth(sp.m)}
          canEdit
        />
      </div>
    );
  }

  // Actual units per product × month for the selected channel scope.
  const actual = new Map<string, number>(); // `${pid}|${idx}`
  const monthsWithData = new Set<number>();
  for (const p of points) {
    monthsWithData.add(p.idx);
    if (!inScope(p.channel)) continue;
    const k = `${p.productId}|${p.idx}`;
    actual.set(k, (actual.get(k) || 0) + p.units);
  }
  const actualOf = (pid: string, idx: number) => actual.get(`${pid}|${idx}`) || 0;
  const totalActual = (idx: number) => products.reduce((s, p) => s + actualOf(p.id, idx), 0);

  const header = (
    <>
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">Forecast &amp; Target</h1>
        <p className="text-sm text-gray-500 mt-1">
          {latestBase != null
            ? `Next 3 months from sales data through ${label(latestBase)} · ${CHANNEL_LABELS[channel]} · main-product-equivalent units`
            : "Forecasts appear once there are complete months of sales"}
        </p>
      </div>
      <div className="flex items-center gap-1 bg-gray-100 rounded-md p-1">
        {(["total", "online", "offline"] as Channel[]).map((c) => (
          <Link
            key={c}
            href={`/sales/forecast?c=${c}`}
            className={cn(
              "px-3 py-1 rounded text-sm font-medium transition-colors",
              channel === c ? "bg-white text-brand shadow-sm" : "text-gray-600 hover:text-gray-900"
            )}
          >
            {CHANNEL_LABELS[c]}
          </Link>
        ))}
      </div>
    </div>
    {viewTabs}
    </>
  );

  if (latestBase == null) {
    return (
      <div className="space-y-6">
        {header}
        <Card>
          <CardContent className="py-8 text-center text-sm text-gray-500">
            No complete month yet — a month counts once both its online and offline sales are
            uploaded.
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---- Next 3 months ----
  const targets = [1, 2, 3].map((k) => latestBase + k);
  const recentIdx = [latestBase - 2, latestBase - 1, latestBase];
  const recentAvg = recentIdx.reduce((s, i) => s + totalActual(i), 0) / recentIdx.length;
  const forecastFor = (t: number) =>
    live
      .filter((r) => monthIndex(r.target_year, r.target_month) === t && inScope(r.channel))
      .reduce((s, r) => s + r.forecast_units, 0);
  const nextMonths = targets.map((t) => ({
    idx: t,
    forecast: forecastFor(t),
    lastYear: monthsWithData.has(t - 12) ? totalActual(t - 12) : null,
  }));

  // ---- Accuracy: saved forecasts vs actuals (complete months only) ----
  type Group = { backfill: boolean; per: Map<string, { forecast: number; baseline: number }> };
  const groups = new Map<string, Group>(); // `${targetIdx}|${horizon}`
  for (const r of saved) {
    if (!inScope(r.channel)) continue;
    const key = `${monthIndex(r.target_year, r.target_month)}|${r.horizon}`;
    let g = groups.get(key);
    if (!g) {
      g = { backfill: true, per: new Map() };
      groups.set(key, g);
    }
    if (!r.is_backfill) g.backfill = false;
    const e = g.per.get(r.product_id) || { forecast: 0, baseline: 0 };
    e.forecast += r.forecast_units;
    e.baseline += r.baseline_units;
    g.per.set(r.product_id, e);
  }
  const evalFor = (t: number, h: number): (AccuracySummary & { backfill: boolean }) | null => {
    const g = groups.get(`${t}|${h}`);
    if (!g) return null;
    const pairs = [...g.per.entries()].map(([pid, v]) => ({ ...v, actual: actualOf(pid, t) }));
    return { ...summarizeAccuracy(pairs), backfill: g.backfill };
  };
  const evaluated = complete
    .filter((t) => [1, 2, 3].some((h) => groups.has(`${t}|${h}`)))
    .sort((a, b) => b - a)
    .map((t) => ({ idx: t, h1: evalFor(t, 1), h2: evalFor(t, 2), h3: evalFor(t, 3) }));
  const recentEval = evaluated.slice(0, EVAL_WINDOW);
  const avgOf = (pick: (e: (typeof evaluated)[number]) => number | null | undefined) => {
    const vals = recentEval.map(pick).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };
  const avg = {
    h1: avgOf((e) => e.h1?.accuracy),
    base: avgOf((e) => e.h1?.baselineAccuracy),
    h2: avgOf((e) => e.h2?.accuracy),
    h3: avgOf((e) => e.h3?.accuracy),
    bias: avgOf((e) => e.h1?.bias),
  };
  const lastEval = evaluated.find((e) => e.h1);

  // ---- Product table ----
  const prevBase = fromMonthIndex(latestBase - 1);
  const latest = fromMonthIndex(latestBase);
  const rows: ForecastTableRow[] = [];
  for (const p of products) {
    const liveRows = live.filter((r) => r.product_id === p.id && r.horizon === 1 && inScope(r.channel));
    const recent = recentIdx.map((i) => actualOf(p.id, i));
    const forecast = liveRows.reduce((s, r) => s + r.forecast_units, 0);
    if (!liveRows.length && recent.every((v) => v === 0)) continue;
    let errWeighted = 0;
    let errBase = 0;
    for (const r of liveRows) {
      if (r.backtest_error == null) continue;
      errWeighted += r.backtest_error * r.forecast_units;
      errBase += r.forecast_units;
    }
    const lastRows = saved.filter(
      (r) =>
        r.product_id === p.id &&
        r.horizon === 1 &&
        r.base_year === prevBase.year &&
        r.base_month === prevBase.month &&
        r.target_year === latest.year &&
        r.target_month === latest.month &&
        inScope(r.channel)
    );
    rows.push({
      id: p.id,
      sku: p.sku,
      label: p.variation || p.name,
      family: p.product_family || p.name,
      category: p.category,
      recent,
      forecast,
      errWeighted,
      errBase,
      last: lastRows.length
        ? {
            forecast: lastRows.reduce((s, r) => s + r.forecast_units, 0),
            actual: actualOf(p.id, latestBase),
          }
        : null,
      method:
        liveRows
          .map((r) => `${r.channel === "ONLINE" ? "Online" : "Offline"}: ${METHOD_LABELS[r.method]}`)
          .join(" · ") || "No forecast",
      isNew: liveRows.some((r) => r.method === "SHORT"),
    });
  }

  return (
    <div className="space-y-6">
      {header}

      {saveError && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          The forecast is shown but couldn&rsquo;t be saved for accuracy tracking: {saveError}
        </div>
      )}

      {/* Next 3 months + last accuracy */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {nextMonths.map((m, i) => {
          const chg = recentAvg > 0 ? m.forecast / recentAvg - 1 : null;
          return (
            <Card key={m.idx}>
              <CardContent className="py-4">
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  {label(m.idx)} forecast
                  {i === 0 && <span className="ml-1 normal-case text-gray-400">· next</span>}
                </div>
                <div className="text-2xl font-semibold mt-1 tabular-nums">{n(m.forecast)}</div>
                <div className="text-xs text-gray-500 mt-1">
                  vs last 3-mo avg {n(recentAvg)}{" "}
                  <span
                    className={cn(
                      "font-medium",
                      chg == null
                        ? ""
                        : chg >= 0.05
                        ? "text-emerald-600"
                        : chg <= -0.05
                        ? "text-red-600"
                        : "text-gray-500"
                    )}
                  >
                    {signedPct(chg)}
                  </span>
                </div>
                {m.lastYear != null && (
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    Same month last year: {n(m.lastYear)}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        <Card className="border-l-4 border-l-brand/60">
          <CardContent className="py-4">
            <div className="text-xs uppercase tracking-wide text-gray-500">
              Forecast accuracy{lastEval ? ` · ${label(lastEval.idx)}` : ""}
            </div>
            {lastEval?.h1 ? (
              <>
                <div className="text-2xl font-semibold mt-1 tabular-nums">
                  {pct(lastEval.h1.accuracy)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  3-mo average would be {pct(lastEval.h1.baselineAccuracy)} · bias{" "}
                  {signedPct(lastEval.h1.bias)}
                </div>
                <div className="text-[11px] text-gray-400 mt-0.5">
                  {recentEval.length}-mo avg: {pct(avg.h1)} vs {pct(avg.base)}
                </div>
              </>
            ) : (
              <div className="text-sm text-gray-500 mt-2">
                Shows once a forecasted month&rsquo;s sales are uploaded.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Product forecast */}
      <Card>
        <CardHeader>
          <CardTitle>Forecast by product range</CardTitle>
          <p className="text-xs text-gray-500 mt-1">
            Forecast per month for {short(targets[0])} – {short(targets[2])}. Reliability = how close
            this method has come for the product over the last 6 months; hover a product for its
            method.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <ForecastTable
            rows={rows}
            recentLabels={recentIdx.map(short)}
            forecastLabel={`${short(targets[0])} – ${short(targets[2])}`}
            lastMonthLabel={MONTHS[latest.month]}
          />
        </CardContent>
      </Card>

      {/* Accuracy tracker */}
      <Card>
        <CardHeader>
          <CardTitle>Accuracy tracker</CardTitle>
          <p className="text-xs text-gray-500 mt-1">
            Each month&rsquo;s actual sales vs what was forecast 1, 2 and 3 months earlier, product by
            product. Accuracy = 1 − (total product-level error ÷ actual units). Bias above 0 means
            the forecast was too high.
          </p>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide">
                <th className="py-2 pl-4 pr-3 font-semibold">Month</th>
                <th className="py-2 px-3 font-semibold text-right">Forecast</th>
                <th className="py-2 px-3 font-semibold text-right">Actual</th>
                <th className="py-2 px-3 font-semibold text-right">Accuracy</th>
                <th className="py-2 px-3 font-semibold text-right">Bias</th>
                <th
                  className="py-2 px-3 font-semibold text-right"
                  title="Accuracy if the plain 3-month average (the dashboard's AMS) had been used"
                >
                  3-mo avg
                </th>
                <th className="py-2 px-3 font-semibold text-right">2 mo ahead</th>
                <th className="py-2 pr-4 pl-3 font-semibold text-right">3 mo ahead</th>
              </tr>
              <tr className="text-[10px] text-gray-400 border-b border-gray-200 bg-gray-50">
                <th className="pb-1.5 pl-4 pr-3 font-normal"></th>
                <th colSpan={5} className="pb-1.5 px-3 font-normal text-center">
                  forecast made 1 month earlier
                </th>
                <th colSpan={2} className="pb-1.5 px-3 font-normal text-center">
                  accuracy
                </th>
              </tr>
            </thead>
            <tbody>
              {nextMonths.map((m, i) => (
                <tr key={`p${m.idx}`} className="border-b border-gray-100 text-gray-500 bg-brand/5">
                  <td className="py-2 pl-4 pr-3">
                    {label(m.idx)}
                    <span className="ml-2 text-[10px] uppercase bg-white border border-gray-200 text-gray-500 px-1.5 py-0.5 rounded">
                      awaiting sales
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">
                    {n(m.forecast)}
                    {i > 0 && <span className="text-[10px] text-gray-400"> ({i + 1}-mo)</span>}
                  </td>
                  <td colSpan={6} className="py-2 px-3 text-right text-xs text-gray-400">
                    scored after {label(m.idx)} sales are uploaded
                  </td>
                </tr>
              ))}
              {evaluated.map((e) => (
                <tr key={e.idx} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 pl-4 pr-3 font-medium text-gray-800">
                    {label(e.idx)}
                    {e.h1?.backfill && (
                      <span
                        className="ml-2 text-[10px] uppercase bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded"
                        title="Re-created from the history available at the time (back-test), not saved live"
                      >
                        backtest
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-gray-600">
                    {e.h1 ? n(e.h1.forecast) : "—"}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-gray-600">
                    {e.h1 ? n(e.h1.actual) : n(totalActual(e.idx))}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums font-semibold">
                    <AccCell v={e.h1?.accuracy ?? null} />
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-gray-600">
                    {signedPct(e.h1?.bias ?? null)}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-gray-400">
                    {pct(e.h1?.baselineAccuracy ?? null)}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">
                    <AccCell v={e.h2?.accuracy ?? null} />
                  </td>
                  <td className="py-2 pr-4 pl-3 text-right tabular-nums">
                    <AccCell v={e.h3?.accuracy ?? null} />
                  </td>
                </tr>
              ))}
              {recentEval.length > 0 && (
                <tr className="bg-gray-50 font-semibold text-gray-800">
                  <td className="py-2 pl-4 pr-3">Average, last {recentEval.length} mo</td>
                  <td className="py-2 px-3" />
                  <td className="py-2 px-3" />
                  <td className="py-2 px-3 text-right tabular-nums">
                    <AccCell v={avg.h1} />
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-gray-600">
                    {signedPct(avg.bias)}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-gray-500">{pct(avg.base)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">
                    <AccCell v={avg.h2} />
                  </td>
                  <td className="py-2 pr-4 pl-3 text-right tabular-nums">
                    <AccCell v={avg.h3} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {evaluated.length === 0 && (
            <p className="text-sm text-gray-500 py-6 text-center">
              Nothing to score yet — accuracy appears once a forecasted month&rsquo;s sales are in.
            </p>
          )}
        </CardContent>
      </Card>

      <details className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
        <summary className="cursor-pointer font-medium text-gray-800">How the forecast works</summary>
        <ul className="mt-3 space-y-1.5 list-disc pl-5">
          <li>
            Each product is forecast separately for online and offline from its own monthly sales.
            Online uses a blend of the 3-month average, the 6-month average and a smoothed level.
            Offline uses slower smoothing, because distributor orders are lumpy and chasing last
            month makes it worse.
          </li>
          <li>
            The methods were picked by replaying every past month as if it were &ldquo;today&rdquo;:
            they beat the plain 3-month average at 1, 2 and 3 months ahead. Trend-following was
            tested too and was less accurate, so it isn&rsquo;t used.
          </li>
          <li>
            A month more than 3× a product&rsquo;s usual level is capped as a one-off. Products with 3
            months of history or less use the average so far (tagged <em>new</em>).
          </li>
          <li>
            Seasonal peaks (e.g. 11.11, 12.12) aren&rsquo;t modelled yet — that needs at least two years
            of history. &ldquo;Same month last year&rdquo; is shown for context.
          </li>
          <li>
            A month counts once both its online and offline sales are uploaded. Each month&rsquo;s
            forecast is saved and stops changing once the next month&rsquo;s sales arrive; months
            before this page existed are re-created from the history at the time and tagged{" "}
            <em>backtest</em>.
          </li>
        </ul>
      </details>
    </div>
  );
}

function AccCell({ v }: { v: number | null }) {
  if (v == null) return <span className="text-gray-300">—</span>;
  const cls = v >= 0.8 ? "text-emerald-700" : v >= 0.6 ? "text-amber-600" : "text-red-600";
  return <span className={cls}>{Math.round(v * 100)}%</span>;
}
