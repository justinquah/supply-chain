"use client";

import { Fragment, useState } from "react";
import { cn } from "@/lib/utils";

export type ForecastTableRow = {
  id: string;
  sku: string;
  label: string;
  family: string;
  category: string;
  /** actual units for the recent months (oldest → newest) */
  recent: number[];
  /** forecast units per month for the next 3 months */
  forecast: number;
  /** Σ backtest_error × forecast, over channels with a back-test */
  errWeighted: number;
  /** Σ forecast over channels with a back-test */
  errBase: number;
  /** last month: what was forecast 1 month ahead vs what sold */
  last: { forecast: number; actual: number } | null;
  method: string;
  isNew: boolean;
};

type Agg = {
  recent: number[];
  forecast: number;
  errWeighted: number;
  errBase: number;
  lastErr: number;
  lastActual: number;
  lastCount: number;
};

function aggregate(rows: ForecastTableRow[], nRecent: number): Agg {
  const a: Agg = {
    recent: Array(nRecent).fill(0),
    forecast: 0,
    errWeighted: 0,
    errBase: 0,
    lastErr: 0,
    lastActual: 0,
    lastCount: 0,
  };
  for (const r of rows) {
    r.recent.forEach((v, i) => (a.recent[i] += v));
    a.forecast += r.forecast;
    a.errWeighted += r.errWeighted;
    a.errBase += r.errBase;
    if (r.last) {
      a.lastErr += Math.abs(r.last.forecast - r.last.actual);
      a.lastActual += r.last.actual;
      a.lastCount++;
    }
  }
  return a;
}

const n = (v: number) => Math.round(v).toLocaleString("en-MY");

function Pct({ v, tone }: { v: number | null; tone?: "acc" | "change" }) {
  if (v == null) return <span className="text-gray-300">—</span>;
  const pct = Math.round(v * 100);
  let cls = "text-gray-600";
  if (tone === "acc") {
    cls = v >= 0.8 ? "text-emerald-700" : v >= 0.6 ? "text-amber-600" : "text-red-600";
  } else if (tone === "change") {
    cls = pct >= 10 ? "text-emerald-600" : pct <= -10 ? "text-red-600" : "text-gray-500";
  }
  return (
    <span className={cn("tabular-nums", cls)}>
      {tone === "change" && pct > 0 ? "+" : ""}
      {pct}%
    </span>
  );
}

function reliability(a: { errWeighted: number; errBase: number }): number | null {
  return a.errBase > 0 ? Math.max(0, 1 - a.errWeighted / a.errBase) : null;
}
function lastAccuracy(a: Agg): number | null {
  if (!a.lastCount) return null;
  if (a.lastActual <= 0) return a.lastErr === 0 ? null : 0;
  return Math.max(0, 1 - a.lastErr / a.lastActual);
}
function change(a: Agg): number | null {
  const avg = a.recent.reduce((s, x) => s + x, 0) / (a.recent.length || 1);
  return avg > 0 ? a.forecast / avg - 1 : null;
}

export function ForecastTable({
  rows,
  recentLabels,
  forecastLabel,
  lastMonthLabel,
}: {
  rows: ForecastTableRow[];
  recentLabels: string[];
  forecastLabel: string;
  lastMonthLabel: string;
}) {
  const [openCategory, setOpenCategory] = useState<Record<string, boolean>>({});
  const [openRange, setOpenRange] = useState<Record<string, boolean>>({});
  const nRecent = recentLabels.length;

  // Category → range → products
  const catMap = new Map<string, Map<string, ForecastTableRow[]>>();
  for (const r of rows) {
    if (!catMap.has(r.category)) catMap.set(r.category, new Map());
    const fams = catMap.get(r.category)!;
    if (!fams.has(r.family)) fams.set(r.family, []);
    fams.get(r.family)!.push(r);
  }
  const categories = [...catMap.entries()]
    .map(([category, fams]) => {
      const ranges = [...fams.entries()]
        .map(([family, items]) => ({
          family,
          items: [...items].sort((a, b) => b.forecast - a.forecast),
          agg: aggregate(items, nRecent),
        }))
        .sort((a, b) => b.agg.forecast - a.agg.forecast);
      return { category, ranges, agg: aggregate([...fams.values()].flat(), nRecent) };
    })
    .sort((a, b) => b.agg.forecast - a.agg.forecast);

  const isCatOpen = (c: string) => (c in openCategory ? openCategory[c] : true);
  const isRangeOpen = (k: string) => (k in openRange ? openRange[k] : false);

  function Cells({ a, dense }: { a: Agg; dense?: boolean }) {
    const py = dense ? "py-1.5" : "py-2.5";
    return (
      <>
        {a.recent.map((v, i) => (
          <td key={i} className={cn("px-3 text-right tabular-nums text-gray-400", py)}>
            {n(v)}
          </td>
        ))}
        <td className={cn("px-3 text-right tabular-nums font-semibold text-gray-900 bg-brand/5", py)}>
          {n(a.forecast)}
        </td>
        <td className={cn("px-3 text-right tabular-nums text-gray-600 bg-brand/5", py)}>
          {n(a.forecast * 3)}
        </td>
        <td className={cn("px-3 text-right", py)}>
          <Pct v={change(a)} tone="change" />
        </td>
        <td className={cn("px-3 text-right", py)}>
          <Pct v={reliability(a)} tone="acc" />
        </td>
        <td className={cn("px-3 text-right", py)}>
          <Pct v={lastAccuracy(a)} tone="acc" />
        </td>
      </>
    );
  }

  return (
    <div className="overflow-auto max-h-[75vh] bg-white rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-20">
          <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide">
            <th className="py-2 pl-4 pr-3 font-semibold sticky left-0 z-30 bg-gray-50">
              Category · range · product
            </th>
            {recentLabels.map((l) => (
              <th key={l} className="py-2 px-3 font-semibold text-right whitespace-nowrap">
                {l}
                <div className="text-[9px] font-normal normal-case text-gray-400">actual</div>
              </th>
            ))}
            <th className="py-2 px-3 font-semibold text-right whitespace-nowrap bg-brand/10 text-brand">
              Forecast / mo
              <div className="text-[9px] font-normal normal-case">{forecastLabel}</div>
            </th>
            <th className="py-2 px-3 font-semibold text-right whitespace-nowrap bg-brand/10 text-brand">
              3-mo total
            </th>
            <th
              className="py-2 px-3 font-semibold text-right whitespace-nowrap"
              title="Forecast per month vs the average of the last 3 actual months"
            >
              vs last 3 mo
            </th>
            <th
              className="py-2 px-3 font-semibold text-right whitespace-nowrap"
              title="How accurate this forecast method has been for this product over the last 6 months (back-test, 1–3 months ahead)"
            >
              Reliability
            </th>
            <th
              className="py-2 pr-4 pl-3 font-semibold text-right whitespace-nowrap"
              title={`What was forecast for ${lastMonthLabel} a month earlier vs what actually sold`}
            >
              {lastMonthLabel} accuracy
            </th>
          </tr>
        </thead>
        <tbody>
          {categories.map((cg) => {
            const catOpen = isCatOpen(cg.category);
            return (
              <Fragment key={cg.category}>
                <tr
                  className="border-b border-gray-200 bg-white cursor-pointer hover:bg-gray-50"
                  onClick={() =>
                    setOpenCategory((o) => ({ ...o, [cg.category]: !isCatOpen(cg.category) }))
                  }
                >
                  <td className="py-2.5 pl-4 pr-3 font-semibold text-gray-900 sticky left-0 z-10 bg-white">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-gray-400 text-xs w-3">{catOpen ? "▾" : "▸"}</span>
                      {cg.category}
                      <span className="text-xs text-gray-400 font-normal">({cg.ranges.length})</span>
                    </span>
                  </td>
                  <Cells a={cg.agg} />
                </tr>
                {catOpen &&
                  cg.ranges.map((rg) => {
                    const key = `${cg.category}|${rg.family}`;
                    const multi = rg.items.length > 1;
                    const open = isRangeOpen(key);
                    const single = !multi ? rg.items[0] : null;
                    return (
                      <Fragment key={key}>
                        <tr
                          className={cn(
                            "border-b border-gray-100 bg-white text-gray-700",
                            multi && "cursor-pointer hover:bg-gray-50"
                          )}
                          onClick={() =>
                            multi && setOpenRange((o) => ({ ...o, [key]: !isRangeOpen(key) }))
                          }
                          title={single ? single.method : undefined}
                        >
                          <td className="py-2 pl-8 pr-3 font-medium sticky left-0 z-10 bg-white">
                            <span className="inline-flex items-center gap-1.5">
                              {multi ? (
                                <span className="text-gray-400 text-xs w-3">{open ? "▾" : "▸"}</span>
                              ) : (
                                <span className="w-3" />
                              )}
                              {rg.family}
                              {multi && (
                                <span className="text-xs text-gray-400 font-normal">
                                  ({rg.items.length})
                                </span>
                              )}
                              {single?.isNew && <NewTag />}
                            </span>
                          </td>
                          <Cells a={rg.agg} />
                        </tr>
                        {multi &&
                          open &&
                          rg.items.map((p) => (
                            <tr
                              key={p.id}
                              className="border-b border-gray-100 bg-gray-50/40 text-gray-600"
                              title={`${p.sku} · ${p.method}`}
                            >
                              <td className="py-1.5 pl-12 pr-3 sticky left-0 z-10 bg-gray-50">
                                {p.label}
                                {p.isNew && <NewTag />}
                              </td>
                              <Cells a={aggregate([p], nRecent)} dense />
                            </tr>
                          ))}
                      </Fragment>
                    );
                  })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {categories.length === 0 && (
        <p className="text-sm text-gray-500 py-8 text-center">No products to forecast.</p>
      )}
    </div>
  );
}

function NewTag() {
  return (
    <span
      className="ml-1.5 text-[10px] uppercase bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded"
      title="3 months of history or less — forecast is the average so far, not back-tested"
    >
      new
    </span>
  );
}
