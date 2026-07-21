"use client";

import { Fragment, useState } from "react";
import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/sparkline";
import { computeMomentum, fmtGrowth, type Momentum } from "@/lib/sales-trend";

function MomentumBadge({ m }: { m: Momentum }) {
  if (m.quiet) return <span className="text-gray-300 text-xs">—</span>;
  const map = {
    up: { cls: "bg-emerald-50 text-emerald-700", label: "Growing" },
    down: { cls: "bg-red-50 text-red-700", label: "Declining" },
    flat: { cls: "bg-gray-100 text-gray-500", label: "Steady" },
  } as const;
  const s = map[m.dir];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap", s.cls)}>
      {m.dir === "up" ? "▲" : m.dir === "down" ? "▼" : "▪"} {s.label}
      <span className="opacity-70">{fmtGrowth(m.growthPct)}</span>
    </span>
  );
}

const MONTHS = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export type TrendMonth = {
  year: number;
  month: number;
};

export type TrendProductRow = {
  id: string;
  sku: string;
  name: string;
  variation: string | null;
  product_family: string | null;
  category: string;
  /** month key (`${year}-${month}`) -> units for the selected channel */
  units: Record<string, number>;
};

function n(v: number) {
  return Math.round(v).toLocaleString("en-MY");
}

function monthKey(m: TrendMonth) {
  return `${m.year}-${m.month}`;
}

function monthLabel(m: TrendMonth) {
  return `${MONTHS[m.month]} ${String(m.year).slice(-2)}`;
}

type RangeGroup = {
  family: string;
  rows: TrendProductRow[];
  units: Record<string, number>;
  total: number;
};

type CategoryGroup = {
  category: string;
  ranges: RangeGroup[];
  units: Record<string, number>;
  total: number;
};

/** Small inline trend cue: compares the last two month values. */
function TrendCue({ prev, latest }: { prev: number | undefined; latest: number }) {
  if (prev == null || prev === 0) return null;
  if (latest === prev) return null;
  const up = latest > prev;
  return (
    <span className={cn("ml-1 text-[10px]", up ? "text-emerald-600" : "text-red-500")}>
      {up ? "▲" : "▼"}
    </span>
  );
}

export function SalesTrendTable({
  products,
  months,
}: {
  products: TrendProductRow[];
  months: TrendMonth[];
}) {
  // Two independent expand states: categories default OPEN, ranges default CLOSED.
  const [openCategory, setOpenCategory] = useState<Record<string, boolean>>({});
  const [openRange, setOpenRange] = useState<Record<string, boolean>>({});

  // Build Category -> Range -> rows, aggregating monthly units at every level.
  const catMap = new Map<string, CategoryGroup>();
  for (const p of products) {
    const cat = p.category || "Uncategorised";
    const fam = p.product_family || p.name;

    let cg = catMap.get(cat);
    if (!cg) {
      cg = { category: cat, ranges: [], units: {}, total: 0 };
      catMap.set(cat, cg);
    }

    let rg = cg.ranges.find((r) => r.family === fam);
    if (!rg) {
      rg = { family: fam, rows: [], units: {}, total: 0 };
      cg.ranges.push(rg);
    }
    rg.rows.push(p);

    for (const m of months) {
      const key = monthKey(m);
      const v = Number(p.units[key] || 0);
      rg.units[key] = (rg.units[key] || 0) + v;
      rg.total += v;
      cg.units[key] = (cg.units[key] || 0) + v;
      cg.total += v;
    }
  }

  const categories = [...catMap.values()].sort((a, b) => b.total - a.total);
  for (const cg of categories) cg.ranges.sort((a, b) => b.total - a.total);

  function isCategoryOpen(cat: string) {
    if (cat in openCategory) return openCategory[cat];
    return true; // default OPEN
  }
  function isRangeOpen(rangeKey: string) {
    if (rangeKey in openRange) return openRange[rangeKey];
    return false; // default CLOSED
  }

  const lastMonthKey = months.length > 0 ? monthKey(months[months.length - 1]) : null;
  const prevMonthKey = months.length > 1 ? monthKey(months[months.length - 2]) : null;

  function MonthCells({
    units,
    dense,
  }: {
    units: Record<string, number>;
    dense?: boolean;
  }) {
    return (
      <>
        {months.map((m) => {
          const key = monthKey(m);
          const v = Number(units[key] || 0);
          const isLast = key === lastMonthKey;
          const prevV = prevMonthKey ? Number(units[prevMonthKey] || 0) : undefined;
          return (
            <td
              key={key}
              className={cn(
                "px-3 text-right tabular-nums",
                dense ? "py-1.5" : "py-2.5 font-medium"
              )}
            >
              {n(v)}
              {isLast && <TrendCue prev={prevV} latest={v} />}
            </td>
          );
        })}
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
            <th className="py-2 px-3 font-semibold text-center">Trend</th>
            <th className="py-2 px-3 font-semibold text-left whitespace-nowrap">Momentum</th>
            {months.map((m) => (
              <th
                key={monthKey(m)}
                className="py-2 px-3 font-semibold text-right whitespace-nowrap"
              >
                {monthLabel(m)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((cg) => {
            const catExpanded = isCategoryOpen(cg.category);
            const catSeries = months.map((m) => cg.units[monthKey(m)] || 0);
            const catMom = computeMomentum(catSeries);
            return (
              <Fragment key={cg.category}>
                {/* Category row */}
                <tr
                  className="border-b border-gray-200 bg-white cursor-pointer hover:bg-gray-50"
                  onClick={() =>
                    setOpenCategory((o) => ({
                      ...o,
                      [cg.category]: !isCategoryOpen(cg.category),
                    }))
                  }
                >
                  <td className="py-2.5 pl-4 pr-3 font-semibold text-gray-900 sticky left-0 z-10 bg-white">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-gray-400 text-xs w-3">
                        {catExpanded ? "▾" : "▸"}
                      </span>
                      {cg.category}
                      <span className="text-xs text-gray-400 font-normal">
                        ({cg.ranges.length})
                      </span>
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <Sparkline values={catSeries} dir={catMom.dir} />
                  </td>
                  <td className="py-2.5 px-3">
                    <MomentumBadge m={catMom} />
                  </td>
                  <MonthCells units={cg.units} />
                </tr>

                {catExpanded &&
                  cg.ranges.map((rg) => {
                    const rangeKey = `${cg.category}|${rg.family}`;
                    const multi = rg.rows.length > 1;
                    const rangeExpanded = isRangeOpen(rangeKey);
                    const rSeries = months.map((m) => rg.units[monthKey(m)] || 0);
                    const rMom = computeMomentum(rSeries);
                    return (
                      <Fragment key={rangeKey}>
                        {/* Range row */}
                        <tr
                          className={cn(
                            "border-b border-gray-100 bg-white text-gray-700",
                            multi && "cursor-pointer hover:bg-gray-50"
                          )}
                          onClick={() =>
                            multi &&
                            setOpenRange((o) => ({
                              ...o,
                              [rangeKey]: !isRangeOpen(rangeKey),
                            }))
                          }
                        >
                          <td className="py-2 pl-8 pr-3 font-medium sticky left-0 z-10 bg-white">
                            <span className="inline-flex items-center gap-1.5">
                              {multi ? (
                                <span className="text-gray-400 text-xs w-3">
                                  {rangeExpanded ? "▾" : "▸"}
                                </span>
                              ) : (
                                <span className="w-3" />
                              )}
                              {rg.family}
                              {multi && (
                                <span className="text-xs text-gray-400 font-normal">
                                  ({rg.rows.length})
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-center">
                            <Sparkline values={rSeries} dir={rMom.dir} />
                          </td>
                          <td className="py-2 px-3">
                            <MomentumBadge m={rMom} />
                          </td>
                          <MonthCells units={rg.units} />
                        </tr>

                        {rangeExpanded &&
                          rg.rows
                            .slice()
                            .sort((a, b) => {
                              const at = months.reduce((s, m) => s + Number(a.units[monthKey(m)] || 0), 0);
                              const bt = months.reduce((s, m) => s + Number(b.units[monthKey(m)] || 0), 0);
                              return bt - at;
                            })
                            .map((p) => {
                              const pSeries = months.map((m) => Number(p.units[monthKey(m)] || 0));
                              const pMom = computeMomentum(pSeries);
                              return (
                                <tr
                                  key={p.id}
                                  className="border-b border-gray-100 bg-gray-50/40 text-gray-600"
                                >
                                  {/* SKU is not shown — the variation name already
                                      identifies the row. Full code on hover. */}
                                  <td
                                    className="py-1.5 pl-12 pr-3 sticky left-0 z-10 bg-gray-50"
                                    title={p.sku}
                                  >
                                    {p.variation || p.name}
                                  </td>
                                  <td className="py-1.5 px-3 text-center">
                                    <Sparkline values={pSeries} dir={pMom.dir} />
                                  </td>
                                  <td className="py-1.5 px-3">
                                    <MomentumBadge m={pMom} />
                                  </td>
                                  <MonthCells units={p.units} dense />
                                </tr>
                              );
                            })}
                      </Fragment>
                    );
                  })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {categories.length === 0 && (
        <p className="text-sm text-gray-500 py-8 text-center">
          No sales data available.
        </p>
      )}
    </div>
  );
}
