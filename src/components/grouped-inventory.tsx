"use client";

import { Fragment, useState } from "react";
import { cn } from "@/lib/utils";

export type ProductRow = {
  id: string;
  sku: string;
  name: string;
  variation: string | null;
  product_family: string | null;
  current_stock: number;
  ams_total: number;
  ams_online: number;
  ams_offline: number;
  incoming_total: number;
  coverage_months: number | null;
  inventory_value_myr: number;
  monthly_sales_value_myr?: number;
};

/** Per-product incoming quantities bucketed into 3 calendar-month buckets. */
export type IncomingBuckets = {
  thisMonth: number;
  nextMonth: number;
  following: number;
};

const IDEAL = 1.5;

function n(v: number, dp = 0) {
  return Number(v).toLocaleString("en-MY", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}
function rm(v: number) {
  return "RM " + Number(v).toLocaleString("en-MY", { maximumFractionDigits: 0 });
}

function coverageClass(cov: number | null) {
  if (cov == null) return "text-gray-400";
  if (cov < IDEAL) return "text-red-600 font-semibold";
  if (cov < IDEAL * 1.5) return "text-amber-600";
  return "text-emerald-700";
}

type Group = {
  family: string;
  rows: ProductRow[];
  stock: number;
  ams: number;
  amsOnline: number;
  amsOffline: number;
  lastMonthSales: number;
  incomingThis: number;
  incomingNext: number;
  incomingFollowing: number;
  value: number;
  coverage: number | null;
};

export function GroupedInventory({
  products,
  incomingMap,
  lastMonthSalesMap,
  hideValue = false,
  incomingMonthLabels = ["This mo", "Next mo", "Following"],
}: {
  products: ProductRow[];
  /** product_id → IncomingBuckets (may be absent if no incoming) */
  incomingMap?: Record<string, IncomingBuckets>;
  /** product_id → total units sold in prev completed calendar month */
  lastMonthSalesMap?: Record<string, number>;
  /** Hide the monetary "Inv. value" column entirely (STAFF restricted view). */
  hideValue?: boolean;
  /** Headers for the 3 incoming-arrival buckets: [this month, +1, +2]. */
  incomingMonthLabels?: [string, string, string];
}) {
  // All multi-product families start expanded
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // group by family
  const map = new Map<string, Group>();
  for (const p of products) {
    const fam = p.product_family || p.name;
    const buckets = incomingMap?.[p.id] ?? { thisMonth: 0, nextMonth: 0, following: 0 };
    const lastSales = lastMonthSalesMap?.[p.id] ?? 0;
    const g =
      map.get(fam) ??
      ({
        family: fam,
        rows: [],
        stock: 0,
        ams: 0,
        amsOnline: 0,
        amsOffline: 0,
        lastMonthSales: 0,
        incomingThis: 0,
        incomingNext: 0,
        incomingFollowing: 0,
        value: 0,
        coverage: null,
      } satisfies Group);
    g.rows.push(p);
    g.stock += Number(p.current_stock || 0);
    g.ams += Number(p.ams_total || 0);
    g.amsOnline += Number(p.ams_online || 0);
    g.amsOffline += Number(p.ams_offline || 0);
    g.lastMonthSales += Number(lastSales || 0);
    g.incomingThis += Number(buckets.thisMonth || 0);
    g.incomingNext += Number(buckets.nextMonth || 0);
    g.incomingFollowing += Number(buckets.following || 0);
    g.value += Number(p.inventory_value_myr || 0);
    map.set(fam, g);
  }
  const groups = [...map.values()]
    .map((g) => ({
      ...g,
      coverage: g.ams > 0 ? g.stock / g.ams : null,
    }))
    .sort((a, b) => b.ams - a.ams);

  function isOpen(fam: string, multi: boolean) {
    // Default: open if multi-row family (unless explicitly closed by user)
    if (fam in open) return open[fam];
    return multi;
  }

  return (
    <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-500 border-b border-gray-100 bg-gray-50 text-[11px] uppercase tracking-wide">
            <th className="pt-2.5 pb-1 pl-4 pr-3 font-semibold text-left" rowSpan={2}>Product range</th>
            <th className="pt-2.5 pb-1 px-3 font-semibold text-right" rowSpan={2}>Stock</th>
            <th className="pt-2.5 pb-1 px-3 font-semibold text-center border-l border-gray-200" colSpan={3}>Avg monthly sales (3-mo)</th>
            <th className="pt-2.5 pb-1 px-3 font-semibold text-right border-l border-gray-200" rowSpan={2}>Sold<br/>last mo</th>
            <th className="pt-2.5 pb-1 px-3 font-semibold text-center border-l border-gray-200" colSpan={3}>Incoming (units arriving)</th>
            {!hideValue && (
              <th className="pt-2.5 pb-1 px-3 font-semibold text-right border-l border-gray-200" rowSpan={2}>Inv.<br/>value</th>
            )}
            <th className="pt-2.5 pb-1 pr-4 pl-3 font-semibold text-right" rowSpan={2}>Coverage</th>
          </tr>
          <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
            <th className="pb-2 px-3 font-medium text-right border-l border-gray-200">AMS</th>
            <th className="pb-2 px-3 font-medium text-right">Online</th>
            <th className="pb-2 px-3 font-medium text-right">Offline</th>
            <th className="pb-2 px-3 font-medium text-right border-l border-gray-200">{incomingMonthLabels[0]}</th>
            <th className="pb-2 px-3 font-medium text-right">{incomingMonthLabels[1]}</th>
            <th className="pb-2 px-3 font-medium text-right">{incomingMonthLabels[2]}</th>
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
                  <td className="py-2.5 px-3 text-right tabular-nums">
                    {n(g.stock)}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums font-medium">
                    {n(g.ams)}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-gray-500">
                    {n(g.amsOnline)}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-gray-500">
                    {n(g.amsOffline)}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-gray-500">
                    {n(g.lastMonthSales)}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-gray-500">
                    {n(g.incomingThis)}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-gray-500">
                    {n(g.incomingNext)}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-gray-500">
                    {n(g.incomingFollowing)}
                  </td>
                  {!hideValue && (
                    <td className="py-2.5 px-3 text-right tabular-nums text-gray-600">
                      {rm(g.value)}
                    </td>
                  )}
                  <td className="py-2.5 pr-4 pl-3 text-right tabular-nums">
                    <span className={coverageClass(g.coverage)}>
                      {g.coverage == null ? "—" : n(g.coverage, 1) + " mo"}
                    </span>
                  </td>
                </tr>
                {expanded &&
                  g.rows
                    .sort((a, b) => b.ams_total - a.ams_total)
                    .map((p) => {
                      const pb = incomingMap?.[p.id] ?? { thisMonth: 0, nextMonth: 0, following: 0 };
                      const ls = lastMonthSalesMap?.[p.id] ?? 0;
                      return (
                        <tr
                          key={p.id}
                          className="border-b border-gray-100 bg-gray-50/40 text-gray-600"
                        >
                          <td className="py-1.5 pl-10 pr-3">
                            {p.variation || p.name}
                            <span className="text-xs text-gray-400 ml-2">
                              {p.sku}
                            </span>
                          </td>
                          <td className="py-1.5 px-3 text-right tabular-nums">
                            {n(p.current_stock)}
                          </td>
                          <td className="py-1.5 px-3 text-right tabular-nums">
                            {n(p.ams_total)}
                          </td>
                          <td className="py-1.5 px-3 text-right tabular-nums">
                            {n(p.ams_online)}
                          </td>
                          <td className="py-1.5 px-3 text-right tabular-nums">
                            {n(p.ams_offline)}
                          </td>
                          <td className="py-1.5 px-3 text-right tabular-nums">
                            {n(ls)}
                          </td>
                          <td className="py-1.5 px-3 text-right tabular-nums">
                            {n(pb.thisMonth)}
                          </td>
                          <td className="py-1.5 px-3 text-right tabular-nums">
                            {n(pb.nextMonth)}
                          </td>
                          <td className="py-1.5 px-3 text-right tabular-nums">
                            {n(pb.following)}
                          </td>
                          {!hideValue && (
                            <td className="py-1.5 px-3 text-right tabular-nums">
                              {rm(p.inventory_value_myr)}
                            </td>
                          )}
                          <td className="py-1.5 pr-4 pl-3 text-right tabular-nums">
                            <span className={coverageClass(p.coverage_months)}>
                              {p.coverage_months == null
                                ? "—"
                                : n(p.coverage_months, 1) + " mo"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
