import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { createClient, requireRole } from "@/lib/supabase/server";
import { computeMomentum } from "@/lib/sales-trend";

// Sales-trend export as .xlsx. Mirrors the /sales/trend page's aggregation
// (category → range → product) so the numbers match the on-screen table,
// but emits FLAT rows across four sheets — Summary, By product, By range,
// By category — so the SCM can pivot / filter freely in Excel.
//
// Channel-aware: /sales/trend/export?c=online|offline|total (default total).

type Channel = "total" | "online" | "offline";

const CHANNEL_LABELS: Record<Channel, string> = {
  total: "Total",
  online: "Online",
  offline: "Offline",
};

function parseChannel(c: string | null | undefined): Channel {
  if (c === "online" || c === "offline") return c;
  return "total";
}

// "Aug 2026" — same short label the on-screen header uses.
const MONTHS = [
  "",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
function monthHeader(year: number, month: number) {
  return `${MONTHS[month]} ${year}`;
}
function momentumLabel(dir: "up" | "down" | "flat", quiet: boolean): string {
  if (quiet) return "n/a";
  if (dir === "up") return "Growing";
  if (dir === "down") return "Declining";
  return "Steady";
}

export async function GET(req: NextRequest) {
  await requireRole("SCM", "ADMIN");
  const supabase = await createClient();
  const channel = parseChannel(req.nextUrl.searchParams.get("c"));

  // Same shape / filters as page.tsx.
  const { data: sales, error } = await supabase
    .from("monthly_sales")
    .select(
      "year, month, channel, units_equivalent, main_product_id, products(id, sku, name, product_family, variation, is_main, is_active, product_categories(name))"
    );
  if (error) {
    return new Response(`Failed to load sales: ${error.message}`, { status: 500 });
  }
  const rows = sales ?? [];

  // Distinct months
  const monthSet = new Map<string, { year: number; month: number }>();
  for (const r of rows) {
    const key = `${r.year}-${r.month}`;
    if (!monthSet.has(key)) monthSet.set(key, { year: r.year, month: r.month });
  }
  const months = [...monthSet.values()].sort(
    (a, b) => a.year - b.year || a.month - b.month
  );

  // Pivot product × month by channel (main + active only, same as page).
  type ProductBucket = {
    id: string;
    sku: string;
    name: string;
    variation: string | null;
    family: string;
    category: string;
    online: Record<string, number>;
    offline: Record<string, number>;
  };
  const byProduct = new Map<string, ProductBucket>();
  for (const r of rows) {
    const prod = (r as any).products;
    if (!prod || !prod.is_main || !prod.is_active) continue;
    const pid = r.main_product_id as string;
    if (!pid) continue;
    let p = byProduct.get(pid);
    if (!p) {
      p = {
        id: pid,
        sku: prod.sku,
        name: prod.name,
        variation: prod.variation ?? null,
        family: prod.product_family || prod.name,
        category: prod.product_categories?.name || "Uncategorised",
        online: {},
        offline: {},
      };
      byProduct.set(pid, p);
    }
    const key = `${r.year}-${r.month}`;
    const bucket = r.channel === "ONLINE" ? p.online : p.offline;
    bucket[key] = (bucket[key] || 0) + Number(r.units_equivalent || 0);
  }

  // Flatten to the chosen channel's monthly series per product.
  const seriesFor = (bucket: ProductBucket) =>
    months.map((m) => {
      const key = `${m.year}-${m.month}`;
      const on = bucket.online[key] || 0;
      const off = bucket.offline[key] || 0;
      return channel === "online" ? on : channel === "offline" ? off : on + off;
    });

  const productList = [...byProduct.values()]
    .map((b) => ({ b, series: seriesFor(b), mom: computeMomentum(seriesFor(b)) }))
    .sort((a, b) => {
      // Sort: category, then range, then variation (matches on-screen groupings).
      const cat = a.b.category.localeCompare(b.b.category);
      if (cat !== 0) return cat;
      const fam = a.b.family.localeCompare(b.b.family);
      if (fam !== 0) return fam;
      return (a.b.variation ?? a.b.name).localeCompare(b.b.variation ?? b.b.name);
    });

  // Range aggregation
  const rangeMap = new Map<
    string,
    { family: string; category: string; series: number[] }
  >();
  for (const { b, series } of productList) {
    const key = `${b.category}|${b.family}`;
    let g = rangeMap.get(key);
    if (!g) {
      g = { family: b.family, category: b.category, series: months.map(() => 0) };
      rangeMap.set(key, g);
    }
    g.series = g.series.map((v, i) => v + series[i]);
  }
  const ranges = [...rangeMap.values()]
    .map((g) => ({ ...g, mom: computeMomentum(g.series) }))
    .sort((a, b) => {
      const s = (arr: number[]) => arr.reduce((x, y) => x + y, 0);
      return s(b.series) - s(a.series);
    });

  // Category aggregation
  const catMap = new Map<string, number[]>();
  for (const { b, series } of productList) {
    const arr = catMap.get(b.category) ?? months.map(() => 0);
    catMap.set(
      b.category,
      arr.map((v, i) => v + series[i])
    );
  }
  const categories = [...catMap.entries()]
    .map(([category, series]) => ({
      category,
      series,
      mom: computeMomentum(series),
    }))
    .sort((a, b) => {
      const s = (arr: number[]) => arr.reduce((x, y) => x + y, 0);
      return s(b.series) - s(a.series);
    });

  // Overall
  const overall = months.map((_, i) =>
    productList.reduce((s, x) => s + x.series[i], 0)
  );
  const overallMom = computeMomentum(overall);

  // ---- Build XLSX ---------------------------------------------------------
  const wb = XLSX.utils.book_new();
  const monthCols = months.map((m) => monthHeader(m.year, m.month));

  // Summary sheet: latest month, prev month, growth, plus top-ranges / cats.
  const latest = overall.length ? overall[overall.length - 1] : 0;
  const prev = overall.length > 1 ? overall[overall.length - 2] : null;
  const momPct = prev != null && prev > 0 ? (latest - prev) / prev : null;
  const summaryRows: (string | number | null)[][] = [
    [`Sales trend — ${CHANNEL_LABELS[channel]}`],
    [`Generated ${new Date().toISOString().slice(0, 10)}`],
    [],
    ["Metric", "Value"],
    [`Latest month (${monthCols[monthCols.length - 1] ?? "—"})`, Math.round(latest)],
    [`Previous month`, prev == null ? "n/a" : Math.round(prev)],
    [`Month-over-month growth`, momPct == null ? "n/a" : Number((momPct * 100).toFixed(1)) + "%"],
    [`Momentum (long-run)`, momentumLabel(overallMom.dir, overallMom.quiet)],
    [],
    ["Top ranges (latest month)"],
    ["Range", "Category", "Latest", "Momentum", "Growth %"],
  ];
  for (const r of ranges.slice(0, 12)) {
    summaryRows.push([
      r.family,
      r.category,
      Math.round(r.series[r.series.length - 1] || 0),
      momentumLabel(r.mom.dir, r.mom.quiet),
      r.mom.growthPct == null ? "n/a" : Number((r.mom.growthPct * 100).toFixed(1)) + "%",
    ]);
  }
  summaryRows.push([]);
  summaryRows.push(["Categories (latest month)"]);
  summaryRows.push(["Category", "Latest", "Momentum", "Growth %"]);
  for (const c of categories) {
    summaryRows.push([
      c.category,
      Math.round(c.series[c.series.length - 1] || 0),
      momentumLabel(c.mom.dir, c.mom.quiet),
      c.mom.growthPct == null ? "n/a" : Number((c.mom.growthPct * 100).toFixed(1)) + "%",
    ]);
  }
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
  summaryWs["!cols"] = [{ wch: 32 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");

  // "By product" sheet — one row per product, monthly columns.
  const productHeader = [
    "Category",
    "Range",
    "Product",
    "SKU",
    "Momentum",
    "Growth %",
    ...monthCols,
  ];
  const productRows: (string | number)[][] = [productHeader];
  for (const { b, series, mom } of productList) {
    productRows.push([
      b.category,
      b.family,
      b.variation || b.name,
      b.sku,
      momentumLabel(mom.dir, mom.quiet),
      mom.growthPct == null ? "n/a" : Number((mom.growthPct * 100).toFixed(1)) + "%",
      ...series.map((v) => Math.round(v)),
    ]);
  }
  const productWs = XLSX.utils.aoa_to_sheet(productRows);
  productWs["!cols"] = [
    { wch: 14 },
    { wch: 24 },
    { wch: 28 },
    { wch: 22 },
    { wch: 12 },
    { wch: 10 },
    ...monthCols.map(() => ({ wch: 10 })),
  ];
  // Freeze the header + first three descriptor columns so the SCM can scroll.
  productWs["!freeze"] = { xSplit: 4, ySplit: 1 } as any;
  XLSX.utils.book_append_sheet(wb, productWs, "By product");

  // "By range" sheet — one row per range with monthly columns.
  const rangeHeader = ["Category", "Range", "Momentum", "Growth %", ...monthCols];
  const rangeRows: (string | number)[][] = [rangeHeader];
  for (const r of ranges) {
    rangeRows.push([
      r.category,
      r.family,
      momentumLabel(r.mom.dir, r.mom.quiet),
      r.mom.growthPct == null ? "n/a" : Number((r.mom.growthPct * 100).toFixed(1)) + "%",
      ...r.series.map((v) => Math.round(v)),
    ]);
  }
  const rangeWs = XLSX.utils.aoa_to_sheet(rangeRows);
  rangeWs["!cols"] = [
    { wch: 14 },
    { wch: 28 },
    { wch: 12 },
    { wch: 10 },
    ...monthCols.map(() => ({ wch: 10 })),
  ];
  XLSX.utils.book_append_sheet(wb, rangeWs, "By range");

  // "By category" sheet.
  const catHeader = ["Category", "Momentum", "Growth %", ...monthCols];
  const catRows: (string | number)[][] = [catHeader];
  for (const c of categories) {
    catRows.push([
      c.category,
      momentumLabel(c.mom.dir, c.mom.quiet),
      c.mom.growthPct == null ? "n/a" : Number((c.mom.growthPct * 100).toFixed(1)) + "%",
      ...c.series.map((v) => Math.round(v)),
    ]);
  }
  const catWs = XLSX.utils.aoa_to_sheet(catRows);
  catWs["!cols"] = [
    { wch: 20 },
    { wch: 12 },
    { wch: 10 },
    ...monthCols.map(() => ({ wch: 10 })),
  ];
  XLSX.utils.book_append_sheet(wb, catWs, "By category");

  // Serialize
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const fileName = `sales-trend-${channel}-${stamp}.xlsx`;

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
