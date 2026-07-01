import Link from "next/link";
import { createClient, requireRole } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SalesTrendTable, type TrendMonth, type TrendProductRow } from "@/components/sales-trend-table";
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
