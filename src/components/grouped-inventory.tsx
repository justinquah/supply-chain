"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { IncomingLine } from "@/lib/dashboard-data";

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
  /** Arrivals beyond the third month — kept separate so the third column is a
      real single month and not an unbounded "everything after" catch-all. */
  later: number;
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

type Bucket = keyof IncomingBuckets;
/** Which incoming cell is expanded: a range row ("g:<family>") or a product ("p:<id>"). */
type Detail = { key: string; bucket: Bucket } | null;

const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtEta(iso: string | null) {
  if (!iso) return "no ETA";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MON[m]} ${y}`;
}

// A clickable in-transit number. Clicking expands the PO / ETA breakdown row
// beneath it (clicking again, or another cell, switches/closes it).
function IncomingCell({
  value,
  rowKey,
  bucket,
  detail,
  setDetail,
  clickable,
  className,
}: {
  value: number;
  rowKey: string;
  bucket: Bucket;
  detail: Detail;
  setDetail: (d: Detail) => void;
  clickable: boolean;
  className: string;
}) {
  const active = detail?.key === rowKey && detail.bucket === bucket;
  if (!clickable || !(value > 0)) {
    return <td className={className}>{n(value)}</td>;
  }
  return (
    <td className={cn(className, active && "bg-brand/10")}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation(); // don't toggle the range row's expand
          setDetail(active ? null : { key: rowKey, bucket });
        }}
        title="Show POs and ETAs"
        className={cn(
          "tabular-nums underline decoration-dotted underline-offset-4 decoration-gray-300 hover:text-brand hover:decoration-brand",
          active && "text-brand decoration-brand"
        )}
      >
        {n(value)}
      </button>
    </td>
  );
}

// The expanded breakdown: one line per PO + ETA (+ variation on a range row).
function IncomingDetailRow({
  title,
  monthLabel,
  lines,
  showProduct,
  poLinkable,
  todayISO,
  colSpan,
  onClose,
}: {
  title: string;
  monthLabel: string;
  lines: (IncomingLine & { product?: string })[];
  showProduct: boolean;
  poLinkable: boolean;
  todayISO: string | null;
  colSpan: number;
  onClose: () => void;
}) {
  // Merge identical PO + ETA (+ product) lines; sort by ETA.
  const merged = new Map<string, IncomingLine & { product?: string }>();
  for (const l of lines) {
    const k = `${l.poId ?? "-"}|${l.eta ?? "-"}|${showProduct ? l.product ?? "" : ""}`;
    const cur = merged.get(k);
    if (cur) cur.qty += l.qty;
    else merged.set(k, { ...l });
  }
  const rows = [...merged.values()].sort(
    (a, b) => (a.eta ?? "9999").localeCompare(b.eta ?? "9999") || (a.poNumber ?? "").localeCompare(b.poNumber ?? "")
  );
  const total = rows.reduce((s, r) => s + r.qty, 0);
  const poCount = new Set(rows.map((r) => r.poId ?? r.poNumber ?? "-")).size;

  return (
    <tr className="border-b border-gray-100 bg-brand/5">
      <td colSpan={colSpan} className="p-0">
        <div className="sticky left-0 w-fit max-w-[100vw] px-4 py-2.5">
          <div className="flex items-center gap-3 mb-1.5">
            <span className="text-xs font-medium text-gray-700">
              In transit · {monthLabel} · {title}
            </span>
            <span className="text-[11px] text-gray-400">
              {poCount} PO{poCount === 1 ? "" : "s"} · {n(total)} units
            </span>
            <button
              type="button"
              onClick={onClose}
              className="text-[11px] text-gray-400 hover:text-gray-700"
            >
              Close ×
            </button>
          </div>
          <table className="text-xs">
            <thead>
              <tr className="text-left text-gray-400">
                <th className="py-0.5 pr-6 font-medium">PO</th>
                <th className="py-0.5 pr-6 font-medium">ETA</th>
                {showProduct && <th className="py-0.5 pr-6 font-medium">Variation</th>}
                <th className="py-0.5 font-medium text-right">Units</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const overdue = !!(todayISO && r.eta && r.eta < todayISO);
                return (
                  <tr key={i} className="text-gray-700">
                    <td className="py-0.5 pr-6 font-mono">
                      {r.poNumber && r.poId && poLinkable ? (
                        <Link href={`/purchase-orders/${r.poId}`} className="text-brand hover:underline">
                          {r.poNumber}
                        </Link>
                      ) : (
                        r.poNumber ?? <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className={cn("py-0.5 pr-6 tabular-nums", overdue && "text-red-600")}>
                      {fmtEta(r.eta)}
                      {overdue && <span className="ml-1 text-[10px]">overdue</span>}
                    </td>
                    {showProduct && <td className="py-0.5 pr-6">{r.product}</td>}
                    <td className="py-0.5 text-right tabular-nums">{n(r.qty)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </td>
    </tr>
  );
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
  incomingLater: number;
  value: number;
  coverage: number | null;
};

export function GroupedInventory({
  products,
  incomingMap,
  lastMonthSalesMap,
  hideValue = false,
  incomingMonthLabels = ["This mo", "Next mo", "Following", "Later"],
  incomingLines,
  poLinkable = false,
  todayISO = null,
}: {
  products: ProductRow[];
  /** product_id → IncomingBuckets (may be absent if no incoming) */
  incomingMap?: Record<string, IncomingBuckets>;
  /** product_id → PO lines behind the incoming numbers; enables click-to-expand. */
  incomingLines?: Record<string, IncomingLine[]>;
  /** Link PO numbers to the PO page (roles that can open POs). */
  poLinkable?: boolean;
  /** YYYY-MM-DD (KL) — ETAs before this are flagged overdue. */
  todayISO?: string | null;
  /** product_id → total units sold in prev completed calendar month */
  lastMonthSalesMap?: Record<string, number>;
  /** Hide the monetary "Inv. value" column entirely (STAFF restricted view). */
  hideValue?: boolean;
  /** Headers for the incoming-arrival buckets: [this month, +1, +2, later]. */
  incomingMonthLabels?: [string, string, string, string];
}) {
  // All multi-product families start expanded
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [detail, setDetail] = useState<Detail>(null);
  const clickable = !!incomingLines;
  const colSpan = 11 + (hideValue ? 0 : 1);
  const bucketLabel: Record<Bucket, string> = {
    thisMonth: incomingMonthLabels[0],
    nextMonth: incomingMonthLabels[1],
    following: incomingMonthLabels[2],
    later: incomingMonthLabels[3],
  };

  // group by family
  const map = new Map<string, Group>();
  for (const p of products) {
    const fam = p.product_family || p.name;
    const buckets = incomingMap?.[p.id] ?? { thisMonth: 0, nextMonth: 0, following: 0, later: 0 };
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
        incomingLater: 0,
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
    g.incomingLater += Number(buckets.later || 0);
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
    <div className="overflow-auto max-h-[75vh] bg-white rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-20">
          <tr className="text-gray-500 border-b border-gray-100 bg-gray-50 text-[11px] uppercase tracking-wide">
            <th className="pt-2.5 pb-1 pl-4 pr-3 font-semibold text-left sticky left-0 z-30 bg-gray-50" rowSpan={2}>Product range</th>
            <th className="pt-2.5 pb-1 px-3 font-semibold text-right" rowSpan={2}>Stock</th>
            <th className="pt-2.5 pb-1 px-3 font-semibold text-center border-l border-gray-200" colSpan={3}>Avg monthly sales (3-mo)</th>
            <th className="pt-2.5 pb-1 px-3 font-semibold text-right border-l border-gray-200" rowSpan={2}>Sold<br/>last mo</th>
            <th className="pt-2.5 pb-1 px-3 font-semibold text-center border-l border-gray-200" colSpan={4}>Incoming (units arriving)</th>
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
            <th className="pb-2 px-3 font-medium text-right">{incomingMonthLabels[3]}</th>
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
                  <td className="py-2.5 pl-4 pr-3 font-medium text-gray-900 sticky left-0 z-10 bg-white">
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
                  {(
                    [
                      ["thisMonth", g.incomingThis, "text-gray-500"],
                      ["nextMonth", g.incomingNext, "text-gray-500"],
                      ["following", g.incomingFollowing, "text-gray-500"],
                      ["later", g.incomingLater, "text-gray-400"],
                    ] as [Bucket, number, string][]
                  ).map(([b, v, tone]) => (
                    <IncomingCell
                      key={b}
                      value={v}
                      rowKey={"g:" + g.family}
                      bucket={b}
                      detail={detail}
                      setDetail={setDetail}
                      clickable={clickable}
                      className={"py-2.5 px-3 text-right tabular-nums " + tone}
                    />
                  ))}
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
                {detail?.key === "g:" + g.family && incomingLines && (
                  <IncomingDetailRow
                    title={g.family}
                    monthLabel={bucketLabel[detail.bucket]}
                    lines={g.rows.flatMap((p) =>
                      (incomingLines[p.id] ?? [])
                        .filter((l) => l.bucket === detail.bucket)
                        .map((l) => ({ ...l, product: p.variation || p.name }))
                    )}
                    showProduct={multi}
                    poLinkable={poLinkable}
                    todayISO={todayISO}
                    colSpan={colSpan}
                    onClose={() => setDetail(null)}
                  />
                )}
                {expanded &&
                  (() => {
                    return g.rows
                    .sort((a, b) => b.ams_total - a.ams_total)
                    .map((p) => {
                      const pb = incomingMap?.[p.id] ?? { thisMonth: 0, nextMonth: 0, following: 0, later: 0 };
                      const ls = lastMonthSalesMap?.[p.id] ?? 0;
                      return (
                        <Fragment key={p.id}>
                        <tr
                          className="border-b border-gray-100 bg-gray-50/40 text-gray-600"
                        >
                          {/* SKU is not shown — the variation name already identifies
                              the row. Full code stays on hover for reference. */}
                          <td
                            className="py-1.5 pl-10 pr-3 sticky left-0 z-10 bg-gray-50"
                            title={p.sku}
                          >
                            {p.variation || p.name}
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
                          {(
                            [
                              ["thisMonth", pb.thisMonth, ""],
                              ["nextMonth", pb.nextMonth, ""],
                              ["following", pb.following, ""],
                              ["later", pb.later, "text-gray-400"],
                            ] as [Bucket, number, string][]
                          ).map(([b, v, tone]) => (
                            <IncomingCell
                              key={b}
                              value={v}
                              rowKey={"p:" + p.id}
                              bucket={b}
                              detail={detail}
                              setDetail={setDetail}
                              clickable={clickable}
                              className={"py-1.5 px-3 text-right tabular-nums " + tone}
                            />
                          ))}
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
                        {detail?.key === "p:" + p.id && incomingLines && (
                          <IncomingDetailRow
                            title={p.variation || p.name}
                            monthLabel={bucketLabel[detail.bucket]}
                            lines={(incomingLines[p.id] ?? []).filter(
                              (l) => l.bucket === detail.bucket
                            )}
                            showProduct={false}
                            poLinkable={poLinkable}
                            todayISO={todayISO}
                            colSpan={colSpan}
                            onClose={() => setDetail(null)}
                          />
                        )}
                        </Fragment>
                      );
                    });
                  })()}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
