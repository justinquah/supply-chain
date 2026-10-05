import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { createClient, requireRole } from "@/lib/supabase/server";
import {
  IDEAL_COVERAGE,
  OVER_COVERAGE,
  MONTHS,
  loadDashboardData,
  loadWeekTurnovers,
} from "@/lib/dashboard-data";

// Inventory Dashboard export as .xlsx — same data loader as the page, so the
// numbers match the screen for the selected stock week (?w=YYYY-MM-DD).
// STAFF get the value-free version (no RM columns, no weighted turnover),
// mirroring what the page shows them.

function round1(v: number | null) {
  return v == null ? null : Math.round(v * 10) / 10;
}
function round2(v: number | null) {
  return v == null ? null : Math.round(v * 100) / 100;
}
function coverageStatus(cov: number | null): string {
  if (cov == null) return "—";
  if (cov < IDEAL_COVERAGE) return "Below target";
  if (cov > OVER_COVERAGE) return "Overstocked";
  return "On target";
}

export async function GET(req: NextRequest) {
  const me = await requireRole("SCM", "ADMIN", "WAREHOUSE", "LOGISTICS", "STAFF");
  const canSeeValue = me.role !== "STAFF";
  const supabase = await createClient();

  const d = await loadDashboardData(supabase, req.nextUrl.searchParams.get("w") ?? undefined);
  const wb = XLSX.utils.book_new();

  // ---- Summary ------------------------------------------------------------
  const summary: (string | number | null)[][] = [
    ["Inventory Dashboard"],
    ["Stock as of", d.stockAsOf ?? "—"],
    ["AMS window", `3 months ending ${MONTHS[d.amsEndMonth]} ${d.amsEndYear}`],
    ["Sold last mo", `${MONTHS[d.prevMonth]} ${d.prevYear}`],
    ["Generated", new Date().toISOString().slice(0, 10)],
    [],
    ["Metric", "Value"],
    ["Total stock (units)", Math.round(d.totalStock)],
    ["AMS (units / month)", Math.round(d.totalAms)],
    ["Stock coverage (months)", round2(d.overallCoverage)],
  ];
  if (canSeeValue) {
    summary.push(["Inventory value (RM, at cost)", Math.round(d.inventoryValue)]);
    summary.push(["Weighted turnover (months)", round2(d.weightedTurnover)]);
    summary.push(["Target coverage (months)", IDEAL_COVERAGE]);
  }
  const summaryWs = XLSX.utils.aoa_to_sheet(summary);
  summaryWs["!cols"] = [{ wch: 30 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");

  // ---- Weighted turnover by week (value roles only — it's value-weighted) --
  if (canSeeValue) {
    const weeks = await loadWeekTurnovers(supabase, d.snapWeeks);
    const turnoverRows: (string | number | null)[][] = [
      ["Week (stock date)", "Weighted turnover (months)", "Status"],
    ];
    for (const w of weeks) {
      const t = w.turnover;
      const status =
        t == null ? "—" : t > OVER_COVERAGE ? "Over" : t < IDEAL_COVERAGE * 0.75 ? "Under" : "Near target";
      turnoverRows.push([w.week, round2(t), status]);
    }
    const tWs = XLSX.utils.aoa_to_sheet(turnoverRows);
    tWs["!cols"] = [{ wch: 18 }, { wch: 26 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, tWs, "Turnover by week");
  }

  // ---- Inventory by product range -----------------------------------------
  // Outline layout matching the screen: a Range row (totals) followed by its
  // products. Range/Level are repeated on every row so the sheet filters cleanly.
  const [m0, m1, m2, later] = d.incMonthLabels;
  const header = [
    "Level",
    "Range",
    "Product",
    "SKU",
    "Stock",
    "AMS",
    "AMS online",
    "AMS offline",
    "Sold last mo",
    `Incoming ${m0}`,
    `Incoming ${m1}`,
    `Incoming ${m2}`,
    `Incoming ${later}`,
    ...(canSeeValue ? ["Inv. value (RM)"] : []),
    "Coverage (months)",
    "Coverage status",
  ];

  type Agg = {
    stock: number;
    ams: number;
    on: number;
    off: number;
    sold: number;
    i0: number;
    i1: number;
    i2: number;
    iL: number;
    value: number;
  };
  const zero = (): Agg => ({ stock: 0, ams: 0, on: 0, off: 0, sold: 0, i0: 0, i1: 0, i2: 0, iL: 0, value: 0 });

  const groups = new Map<string, { family: string; rows: any[]; agg: Agg }>();
  for (const p of d.products) {
    const fam = p.product_family || p.name;
    let g = groups.get(fam);
    if (!g) {
      g = { family: fam, rows: [], agg: zero() };
      groups.set(fam, g);
    }
    g.rows.push(p);
    const inc = d.incomingMap[p.id] ?? { thisMonth: 0, nextMonth: 0, following: 0, later: 0 };
    g.agg.stock += Number(p.current_stock || 0);
    g.agg.ams += Number(p.ams_total || 0);
    g.agg.on += Number(p.ams_online || 0);
    g.agg.off += Number(p.ams_offline || 0);
    g.agg.sold += d.lastMonthSalesMap[p.id] ?? 0;
    g.agg.i0 += inc.thisMonth;
    g.agg.i1 += inc.nextMonth;
    g.agg.i2 += inc.following;
    g.agg.iL += inc.later;
    g.agg.value += Number(p.inventory_value_myr || 0);
  }
  // Same order as the screen: ranges by AMS desc, products by AMS desc.
  const ranges = [...groups.values()].sort((a, b) => b.agg.ams - a.agg.ams);

  const row = (level: string, family: string, product: string, sku: string, a: Agg, cov: number | null) => [
    level,
    family,
    product,
    sku,
    Math.round(a.stock),
    Math.round(a.ams),
    Math.round(a.on),
    Math.round(a.off),
    Math.round(a.sold),
    Math.round(a.i0),
    Math.round(a.i1),
    Math.round(a.i2),
    Math.round(a.iL),
    ...(canSeeValue ? [Math.round(a.value)] : []),
    round1(cov),
    coverageStatus(cov),
  ];

  const inv: (string | number | null)[][] = [header];
  const total = zero();
  for (const g of ranges) {
    inv.push(row("Range", g.family, "", "", g.agg, g.agg.ams > 0 ? g.agg.stock / g.agg.ams : null));
    for (const k of Object.keys(total) as (keyof Agg)[]) total[k] += g.agg[k];
    for (const p of [...g.rows].sort((a, b) => Number(b.ams_total) - Number(a.ams_total))) {
      const inc = d.incomingMap[p.id] ?? { thisMonth: 0, nextMonth: 0, following: 0, later: 0 };
      const a: Agg = {
        stock: Number(p.current_stock || 0),
        ams: Number(p.ams_total || 0),
        on: Number(p.ams_online || 0),
        off: Number(p.ams_offline || 0),
        sold: d.lastMonthSalesMap[p.id] ?? 0,
        i0: inc.thisMonth,
        i1: inc.nextMonth,
        i2: inc.following,
        iL: inc.later,
        value: Number(p.inventory_value_myr || 0),
      };
      const cov = p.coverage_months == null ? null : Number(p.coverage_months);
      inv.push(row("Product", g.family, p.variation || p.name, p.sku, a, cov));
    }
  }
  inv.push(row("Total", "All ranges", "", "", total, total.ams > 0 ? total.stock / total.ams : null));

  const invWs = XLSX.utils.aoa_to_sheet(inv);
  invWs["!cols"] = header.map((h, i) => ({ wch: i === 1 ? 22 : i === 2 ? 22 : i === 3 ? 26 : Math.max(10, h.length + 2) }));
  invWs["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: inv.length - 1, c: header.length - 1 } }) };
  XLSX.utils.book_append_sheet(wb, invWs, "Inventory by range");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const fileName = `inventory-dashboard-${d.selWeek ?? "latest"}.xlsx`;

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
