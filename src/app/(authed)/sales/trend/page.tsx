import Link from "next/link";
import { createClient, requireRole } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SalesTrendTable, type TrendMonth, type TrendProductRow } from "@/components/sales-trend-table";
import { Sparkline } from "@/components/sparkline";
import { computeMomentum, fmtGrowth, type Momentum } from "@/lib/sales-trend";
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

export default async function SalesTrendPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  await requireRole("SCM", "ACCOUNTS", "FINANCE", "ADMIN");
  const supabase = await createClient();
  const sp = await searchParams;
  const channel = parseChannel(sp.c);

  const { data: sales } = await supabase
    .from("monthly_sales")
    .select(
      "year, month, channel, units_equivalent, main_product_id, products(id, sku, name, product_family, variation, is_main, is_active)"
    );

  const rows = sales ?? [];

  // Distinct (year, month) columns, sorted chronologically.
  const monthSet = new Map<string, TrendMonth>();
  for (const r of rows) {
    const key = `${r.year}-${r.month}`;
    if (!monthSet.has(key)) monthSet.set(key, { year: r.year, month: r.month });
  }
  const months = [...monthSet.values()].sort(
    (a, b) => a.year - b.year || a.month - b.month
  );

  // Pivot: product -> month key -> { online, offline }
  const productMap = new Map<
    string,
    {
      product: TrendProductRow;
      online: Record<string, number>;
      offline: Record<string, number>;
    }
  >();

  for (const r of rows) {
    const prod = (r as any).products;
    if (!prod || !prod.is_main || !prod.is_active) continue;
    const pid = r.main_product_id as string;
    if (!pid) continue;

    let entry = productMap.get(pid);
    if (!entry) {
      entry = {
        product: {
          id: pid,
          sku: prod.sku,
          name: prod.name,
          variation: prod.variation,
          product_family: prod.product_family,
          units: {},
        },
        online: {},
        offline: {},
      };
      productMap.set(pid, entry);
    }

    const key = `${r.year}-${r.month}`;
    const bucket = r.channel === "ONLINE" ? entry.online : entry.offline;
    bucket[key] = (bucket[key] || 0) + Number(r.units_equivalent || 0);
  }

  const products: TrendProductRow[] = [...productMap.values()].map(
    ({ product, online, offline }) => {
      const units: Record<string, number> = {};
      for (const m of months) {
        const key = `${m.year}-${m.month}`;
        const on = online[key] || 0;
        const off = offline[key] || 0;
        units[key] =
          channel === "online" ? on : channel === "offline" ? off : on + off;
      }
      return { ...product, units };
    }
  );

  // ---- Momentum insights (per product + per range) ----
  const seriesOf = (units: Record<string, number>) =>
    months.map((m) => Number(units[`${m.year}-${m.month}`] || 0));

  const withMom = products.map((p) => {
    const s = seriesOf(p.units);
    return { p, series: s, mom: computeMomentum(s) };
  });

  const growers = withMom
    .filter((x) => x.mom.dir === "up")
    .sort((a, b) => b.mom.recentAvg - a.mom.recentAvg)
    .slice(0, 6);
  const decliners = withMom
    .filter((x) => x.mom.dir === "down")
    .sort((a, b) => b.mom.priorAvg - a.mom.priorAvg)
    .slice(0, 6);

  // Range (family) aggregation
  const famSeries = new Map<string, number[]>();
  for (const { p, series } of withMom) {
    const key = p.product_family || p.name;
    const arr = famSeries.get(key) ?? months.map(() => 0);
    famSeries.set(key, arr.map((v, i) => v + series[i]));
  }
  const growingRanges = [...famSeries.entries()]
    .map(([family, s]) => ({ family, series: s, mom: computeMomentum(s) }))
    .filter((r) => r.mom.dir === "up")
    .sort((a, b) => b.mom.recentAvg - a.mom.recentAvg)
    .slice(0, 5);

  const overall = months.map((m, i) =>
    withMom.reduce((s, x) => s + x.series[i], 0)
  );
  const overallMom = computeMomentum(overall);

  const label = (p: TrendProductRow) => p.variation || p.name;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Sales Trend</h1>
          <p className="text-sm text-gray-500 mt-1">
            Units sold per month · {CHANNEL_LABELS[channel]} · main-product-equivalent
            units
          </p>
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-md p-1">
          {(["total", "online", "offline"] as Channel[]).map((c) => (
            <Link
              key={c}
              href={`/sales/trend?c=${c}`}
              className={cn(
                "px-3 py-1 rounded text-sm font-medium transition-colors",
                channel === c
                  ? "bg-white text-brand shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              )}
            >
              {CHANNEL_LABELS[c]}
            </Link>
          ))}
        </div>
      </div>

      {months.length > 0 && (
        <>
          {/* Overall trend */}
          <Card>
            <CardContent className="py-4 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  Total {CHANNEL_LABELS[channel]} units / month
                </div>
                <div className="text-2xl font-semibold mt-1">
                  {overall.length
                    ? Math.round(overall[overall.length - 1]).toLocaleString("en-MY")
                    : "—"}
                  <span className="text-sm font-normal text-gray-400 ml-2">latest month</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <MomBadge m={overallMom} />
                <Sparkline values={overall} dir={overallMom.dir} width={180} height={40} />
              </div>
            </CardContent>
          </Card>

          {/* Action insights */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <InsightList
              title="Push more — growing"
              tone="up"
              hint="momentum up · scale / promote"
              empty="No clear growers yet."
              items={growers.map((x) => ({ label: label(x.p), sku: x.p.sku, series: x.series, mom: x.mom }))}
            />
            <InsightList
              title="Needs attention — declining"
              tone="down"
              hint="momentum down · review price / stock"
              empty="Nothing declining."
              items={decliners.map((x) => ({ label: label(x.p), sku: x.p.sku, series: x.series, mom: x.mom }))}
            />
            <InsightList
              title="Growing ranges — room to expand"
              tone="up"
              hint="strong range · consider more variations"
              empty="No range trending up."
              items={growingRanges.map((r) => ({ label: r.family, sku: "", series: r.series, mom: r.mom }))}
            />
          </div>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>By product range</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {months.length === 0 ? (
            <p className="text-sm text-gray-500 py-8 text-center">
              No sales data available.
            </p>
          ) : (
            <SalesTrendTable products={products} months={months} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MomBadge({ m }: { m: Momentum }) {
  if (m.quiet) return <span className="text-gray-400 text-xs">not enough data</span>;
  const map = {
    up: { cls: "bg-emerald-50 text-emerald-700", label: "Growing" },
    down: { cls: "bg-red-50 text-red-700", label: "Declining" },
    flat: { cls: "bg-gray-100 text-gray-500", label: "Steady" },
  } as const;
  const s = map[m.dir];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium", s.cls)}>
      {m.dir === "up" ? "▲" : m.dir === "down" ? "▼" : "▪"} {s.label}
      <span className="opacity-70">{fmtGrowth(m.growthPct)}</span>
    </span>
  );
}

type InsightItem = { label: string; sku: string; series: number[]; mom: Momentum };

function InsightList({
  title,
  tone,
  hint,
  empty,
  items,
}: {
  title: string;
  tone: "up" | "down";
  hint: string;
  empty: string;
  items: InsightItem[];
}) {
  const dot = tone === "up" ? "bg-emerald-500" : "bg-red-500";
  const edge = tone === "up" ? "border-l-emerald-400" : "border-l-red-400";
  return (
    <div className={cn("rounded-lg border border-gray-200 border-l-4 p-3 bg-white", edge)}>
      <div className="flex items-center gap-1.5">
        <span className={cn("h-2 w-2 rounded-full", dot)} />
        <div className="text-sm font-medium text-gray-800">{title}</div>
      </div>
      <div className="text-[11px] text-gray-400 mb-2 ml-3.5">{hint}</div>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400 py-1">{empty}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.map((it, i) => (
            <li key={it.label + i} className="flex items-center justify-between gap-2 py-1.5">
              <div className="min-w-0">
                <div className="text-sm text-gray-700 truncate">{it.label}</div>
                {it.sku && <div className="text-[10px] text-gray-400 font-mono truncate">{it.sku}</div>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Sparkline values={it.series} dir={it.mom.dir} width={64} height={20} />
                <span
                  className={cn(
                    "text-xs font-medium tabular-nums w-12 text-right",
                    it.mom.dir === "up" ? "text-emerald-600" : it.mom.dir === "down" ? "text-red-600" : "text-gray-400"
                  )}
                >
                  {fmtGrowth(it.mom.growthPct)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
