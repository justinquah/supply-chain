// Loads sales history, keeps saved forecast snapshots up to date, and returns
// everything the forecast page needs. Server-side only (uses a Supabase client).
//
// Snapshot rules:
//  - base month = the latest COMPLETE month (online + offline both uploaded);
//    a half-uploaded month never feeds a forecast.
//  - the latest base's snapshot is re-made whenever sales up to it change, so
//    late uploads/corrections are reflected; older snapshots are frozen —
//    they are what was forecast before the later months' actuals arrived.
//  - a base month with no snapshot (history before this feature, or a month
//    nobody opened the page for) is back-filled from data up to that month and
//    flagged is_backfill, so the accuracy history isn't empty on day one.

import type { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import {
  buildSnapshot,
  completeMonths,
  firstForecastBase,
  fromMonthIndex,
  monthIndex,
  MODEL_VERSION,
  type ForecastChannel,
  type ForecastRow,
  type SalesPoint,
} from "@/lib/forecast";

export type ForecastProduct = {
  id: string;
  sku: string;
  name: string;
  variation: string | null;
  product_family: string | null;
  category: string;
};

export type SavedForecastRow = ForecastRow & {
  base_year: number;
  base_month: number;
  is_backfill: boolean;
};

export type ForecastData = {
  products: ForecastProduct[];
  points: SalesPoint[];
  complete: number[];
  latestBase: number | null;
  /** forecast from data through latestBase (same as its saved snapshot) */
  live: ForecastRow[];
  saved: SavedForecastRow[];
  /** set when snapshots couldn't be saved (page still shows the live forecast) */
  saveError: string | null;
  /** base months written on this load */
  written: number[];
};

const INSERT_CHUNK = 500;

type Supabase = Awaited<ReturnType<typeof createClient>>;

export async function loadForecastData(
  supabase: Supabase,
  { canWrite }: { canWrite: boolean }
): Promise<ForecastData> {
  const [{ data: prodRows }, { data: sales }, { data: bases }] = await Promise.all([
    supabase
      .from("products")
      .select("id, sku, name, variation, product_family, product_categories(name)")
      .eq("is_main", true)
      .eq("is_active", true),
    fetchAll((from, to) =>
      supabase
        .from("monthly_sales")
        .select("main_product_id, channel, year, month, units_equivalent, created_at")
        .order("id", { ascending: true })
        .range(from, to)
    ),
    supabase
      .from("sales_forecast_bases")
      .select("base_year, base_month, is_backfill, generated_at"),
  ]);

  const products: ForecastProduct[] = ((prodRows ?? []) as any[]).map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    variation: p.variation,
    product_family: p.product_family,
    category: p.product_categories?.name || "Uncategorised",
  }));
  const ids = new Set(products.map((p) => p.id));

  const points: SalesPoint[] = [];
  const lastWriteByIdx = new Map<number, number>(); // month idx -> latest created_at (ms)
  for (const r of (sales ?? []) as any[]) {
    if (!ids.has(r.main_product_id)) continue;
    if (r.channel !== "ONLINE" && r.channel !== "OFFLINE") continue;
    const idx = monthIndex(r.year, r.month);
    points.push({
      productId: r.main_product_id,
      channel: r.channel as ForecastChannel,
      idx,
      units: Number(r.units_equivalent || 0),
    });
    const t = r.created_at ? Date.parse(r.created_at) : 0;
    if (t > (lastWriteByIdx.get(idx) ?? 0)) lastWriteByIdx.set(idx, t);
  }

  const complete = completeMonths(points);
  const latestBase = complete.length ? complete[complete.length - 1] : null;
  const firstBase = firstForecastBase(complete);
  const live = latestBase != null ? buildSnapshot(points, ids, latestBase) : [];

  // ---- Keep saved snapshots up to date ----
  const written: number[] = [];
  let saveError: string | null = null;
  if (canWrite && latestBase != null && firstBase != null) {
    const existing = new Map<number, { generatedAt: number }>();
    for (const b of (bases ?? []) as any[]) {
      existing.set(monthIndex(b.base_year, b.base_month), {
        generatedAt: b.generated_at ? Date.parse(b.generated_at) : 0,
      });
    }

    const toWrite: { base: number; isBackfill: boolean; rows: ForecastRow[] }[] = [];
    for (const base of complete) {
      if (base < firstBase) continue;
      const have = existing.get(base);
      if (!have) {
        toWrite.push({
          base,
          isBackfill: base < latestBase,
          rows: base === latestBase ? live : buildSnapshot(points, ids, base),
        });
      } else if (base === latestBase) {
        // Re-make the latest snapshot if any sales up to it were written after it.
        let newest = 0;
        for (const [idx, t] of lastWriteByIdx) if (idx <= base && t > newest) newest = t;
        if (newest > have.generatedAt) toWrite.push({ base, isBackfill: false, rows: live });
      }
    }

    for (const w of toWrite) {
      const { year, month } = fromMonthIndex(w.base);
      const { error: delErr } = await supabase
        .from("sales_forecasts")
        .delete()
        .eq("base_year", year)
        .eq("base_month", month);
      if (delErr) {
        saveError = delErr.message;
        break;
      }
      // generated_at is left to the database default (now()) so it's on the
      // same clock as monthly_sales.created_at for the staleness check above.
      const payload = w.rows.map((r) => ({
        ...r,
        base_year: year,
        base_month: month,
        is_backfill: w.isBackfill,
        model_version: MODEL_VERSION,
      }));
      for (let i = 0; i < payload.length; i += INSERT_CHUNK) {
        const { error } = await supabase
          .from("sales_forecasts")
          .upsert(payload.slice(i, i + INSERT_CHUNK), {
            onConflict: "base_year,base_month,product_id,channel,horizon",
          });
        if (error) {
          saveError = error.message;
          break;
        }
      }
      if (saveError) break;
      written.push(w.base);
    }
  }

  const { data: savedRows } = await fetchAll((from, to) =>
    supabase
      .from("sales_forecasts")
      .select(
        "base_year, base_month, target_year, target_month, horizon, product_id, channel, forecast_units, baseline_units, method, backtest_error, is_backfill"
      )
      .order("id", { ascending: true })
      .range(from, to)
  );
  const saved: SavedForecastRow[] = ((savedRows ?? []) as any[]).map((r) => ({
    ...r,
    forecast_units: Number(r.forecast_units),
    baseline_units: Number(r.baseline_units),
    backtest_error: r.backtest_error == null ? null : Number(r.backtest_error),
  }));

  return { products, points, complete, latestBase, live, saved, saveError, written };
}
