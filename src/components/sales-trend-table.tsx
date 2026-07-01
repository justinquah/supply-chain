"use client";

import { Fragment, useState } from "react";
import { cn } from "@/lib/utils";

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

type Group = {
  family: string;
  rows: TrendProductRow[];
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
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const map = new Map<string, Group>();
  for (const p of products) {
    const fam = p.product_family || p.name;
    const g =
      map.get(fam) ?? ({ family: fam, rows: [], units: {}, total: 0 } satisfies Group);
    g.rows.push(p);
    for (const m of months) {
      const key = monthKey(m);
      const v = Number(p.units[key] || 0);
      g.units[key] = (g.units[key] || 0) + v;
      g.total += v;
    }
    map.set(fam, g);
  }
  const groups = [...map.values()].sort((a, b) => b.total - a.total);

  function isOpen(fam: string, multi: boolean) {
    if (fam in open) return open[fam];
    return multi;
  }

  const lastMonthKey = months.length > 0 ? monthKey(months[months.length - 1]) : null;
  const prevMonthKey = months.length > 1 ? monthKey(months[months.length - 2]) : null;

  return (
    <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide">
            <th className="py-2 pl-4 pr-3 font-semibold">Product range</th>
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
          {groups.map((g) => {
            const multi = g.rows.length > 1;
            const expanded = isOpen(g.family, multi);
            return (
              <Fragment key={g.family}>
                <tr
                  className={cn(
                    "border-b border-gray-100 bg-white",
                    multi && "cursor-pointer hover:bg-gray-50"
                  )}
                  onClick={() =>
                    multi && setOpen((o) => ({ ...o, [g.family]: !isOpen(g.family, true) }))
                  }
                >
                  <td className="py-2.5 pl-4 pr-3 font-medium text-gray-900">
                    <span className="inline-flex items-center gap-1.5">
                      {multi && (
                        <span className="text-gray-400 text-xs w-3">
                          {expanded ? "▾" : "▸"}
                        </span>
                      )}
                      {!multi && <span className="w-3" />}
                      {g.family}
                      {multi && (
                        <span className="text-xs text-gray-400 font-normal">
                          ({g.rows.length})
                        </span>
                      )}
                    </span>
                  </td>
                  {months.map((m) => {
                    const key = monthKey(m);
                    const v = g.units[key] || 0;
                    const isLast = key === lastMonthKey;
                    const prevV = prevMonthKey ? g.units[prevMonthKey] : undefined;
                    return (
                      <td
                        key={key}
                        className="py-2.5 px-3 text-right tabular-nums font-medium"
                      >
                        {n(v)}
                        {isLast && <TrendCue prev={prevV} latest={v} />}
                      </td>
                    );
                  })}
                </tr>
                {expanded &&
                  g.rows
                    .sort((a, b) => {
                      const at = months.reduce((s, m) => s + Number(a.units[monthKey(m)] || 0), 0);
                      const bt = months.reduce((s, m) => s + Number(b.units[monthKey(m)] || 0), 0);
                      return bt - at;
                    })
                    .map((p) => (
                      <tr
                        key={p.id}
                        className="border-b border-gray-100 bg-gray-50/40 text-gray-600"
                      >
                        <td className="py-1.5 pl-10 pr-3">
                          {p.variation || p.name}
                          <span className="text-xs text-gray-400 ml-2">{p.sku}</span>
                        </td>
                        {months.map((m) => {
                          const key = monthKey(m);
                          const v = Number(p.units[key] || 0);
                          const isLast = key === lastMonthKey;
                          const prevV = prevMonthKey ? Number(p.units[prevMonthKey] || 0) : undefined;
                          return (
                            <td key={key} className="py-1.5 px-3 text-right tabular-nums">
                              {n(v)}
                              {isLast && <TrendCue prev={prevV} latest={v} />}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {groups.length === 0 && (
        <p className="text-sm text-gray-500 py-8 text-center">
          No sales data available.
        </p>
      )}
    </div>
  );
}
