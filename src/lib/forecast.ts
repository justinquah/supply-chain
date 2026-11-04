// Sales forecasting — pure functions, no database access.
//
// Each product × channel (online / offline) is forecast from its own monthly
// history. The method per channel was chosen by back-testing on real history
// (Nov 2025 – Oct 2026, every month replayed as if it were "today"):
//
//   ONLINE  — blend of the 3-month average, 6-month average and smoothed level.
//   OFFLINE — slow smoothing: distributor orders are lumpy, so the forecast
//             leans on the longer history instead of chasing last month.
//
// Back-test, SKU-level accuracy vs the dashboard's plain 3-month average:
// 1 month ahead 75.6% vs 72.7%, 2 months 75.0% vs 73.8%, 3 months 74.2% vs
// 72.1%. Trend-following methods scored worse (63–68%) and were dropped.
// Seasonality needs 2+ years of history, so forecasts are a monthly level.
//
// Every forecast only ever sees data up to its base month, so comparing it
// with later actuals is a fair accuracy test.

export const MODEL_VERSION = "v1";
export const FORECAST_HORIZON = 3;
/** Months of history needed before a forecast can be back-tested. */
export const MIN_TRAIN = 3;
/** How many recent starting points the reliability back-test uses. */
export const BACKTEST_ORIGINS = 6;
/** A month above this multiple of the product's median is treated as a one-off spike. */
export const SPIKE_CAP = 3;

export type ForecastChannel = "ONLINE" | "OFFLINE";
export type ForecastMethod = "BLEND" | "SMOOTH" | "SHORT";

export const METHOD_LABELS: Record<ForecastMethod, string> = {
  BLEND: "Blend of 3- & 6-month averages and smoothing",
  SMOOTH: "Slow smoothing (lumpy orders)",
  SHORT: "Average so far (short history)",
};

// ---------------------------------------------------------------------------
// Month index helpers (calendar month as a single integer).
export function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}
export function fromMonthIndex(idx: number): { year: number; month: number } {
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

// ---------------------------------------------------------------------------
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function smoothed(y: number[], alpha: number): number {
  let level = y[0];
  for (let t = 1; t < y.length; t++) level = alpha * y[t] + (1 - alpha) * level;
  return level;
}

/** Drop months before the product's first sale; cap one-off spikes. */
export function cleanHistory(raw: number[]): number[] {
  const first = raw.findIndex((v) => v > 0);
  if (first < 0) return [];
  const y = raw.slice(first).map((v) => Math.max(0, v));
  if (y.length >= 6) {
    const med = median(y.filter((v) => v > 0));
    if (med > 0) return y.map((v) => Math.min(v, med * SPIKE_CAP));
  }
  return y;
}

export function methodFor(channel: ForecastChannel, historyMonths: number): ForecastMethod {
  if (historyMonths <= MIN_TRAIN) return "SHORT";
  return channel === "ONLINE" ? "BLEND" : "SMOOTH";
}

/** Monthly level forecast from cleaned history `y` (oldest → newest). */
export function predictLevel(method: ForecastMethod, y: number[]): number {
  if (!y.length) return 0;
  let v: number;
  if (method === "BLEND") {
    v = (mean(y.slice(-3)) + mean(y.slice(-6)) + smoothed(y, 0.3)) / 3;
  } else if (method === "SMOOTH") {
    v = smoothed(y, 0.2);
  } else {
    v = mean(y);
  }
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Re-run the method from each of the last few months and compare with what
 * then sold over the following 1–3 months: Σ|F−A| / ΣA. Null if untestable.
 */
function backtestError(channel: ForecastChannel, y: number[], h: number): number | null {
  let absErr = 0;
  let actual = 0;
  for (let o = Math.max(MIN_TRAIN, y.length - BACKTEST_ORIGINS); o < y.length; o++) {
    const hist = y.slice(0, o);
    const f = predictLevel(methodFor(channel, hist.length), hist);
    for (let k = 0; k < h && o + k < y.length; k++) {
      absErr += Math.abs(f - y[o + k]);
      actual += y[o + k];
    }
  }
  return actual > 0 ? absErr / actual : null;
}

export type SeriesForecast = {
  method: ForecastMethod;
  /** forecast units per month for the next months (level → same each month) */
  perMonth: number;
  /** the dashboard's plain 3-month average, kept for comparison */
  baseline: number;
  /** back-tested error (Σ|F−A| / ΣA); 1 − this = how reliable this product is */
  backtestError: number | null;
};

export function forecastSeries(
  raw: number[],
  channel: ForecastChannel,
  h = FORECAST_HORIZON
): SeriesForecast | null {
  const y = cleanHistory(raw);
  if (!y.length) return null;
  const firstSale = raw.findIndex((v) => v > 0);
  const method = methodFor(channel, y.length);
  return {
    method,
    perMonth: predictLevel(method, y),
    baseline: mean(raw.slice(Math.max(firstSale, raw.length - 3))),
    backtestError: y.length > MIN_TRAIN ? backtestError(channel, y, h) : null,
  };
}

// ---------------------------------------------------------------------------
// Snapshot: every product × channel forecast made from data up to `baseIdx`.

export type SalesPoint = {
  productId: string;
  channel: ForecastChannel;
  idx: number; // monthIndex
  units: number;
};

export type ForecastRow = {
  product_id: string;
  channel: ForecastChannel;
  horizon: number;
  target_year: number;
  target_month: number;
  forecast_units: number;
  baseline_units: number;
  method: ForecastMethod;
  backtest_error: number | null;
};

/** Months that have both online and offline data (a "complete" month). */
export function completeMonths(points: SalesPoint[]): number[] {
  const seen = new Map<number, Set<ForecastChannel>>();
  for (const p of points) {
    if (!seen.has(p.idx)) seen.set(p.idx, new Set());
    seen.get(p.idx)!.add(p.channel);
  }
  return [...seen.entries()]
    .filter(([, s]) => s.has("ONLINE") && s.has("OFFLINE"))
    .map(([i]) => i)
    .sort((a, b) => a - b);
}

/** Earliest base month a snapshot is worth making for (needs MIN_TRAIN months). */
export function firstForecastBase(complete: number[]): number | null {
  return complete.length ? complete[0] + MIN_TRAIN - 1 : null;
}

export function buildSnapshot(
  points: SalesPoint[],
  productIds: Set<string>,
  baseIdx: number,
  h = FORECAST_HORIZON
): ForecastRow[] {
  const used = points.filter((p) => p.idx <= baseIdx && productIds.has(p.productId));
  if (!used.length) return [];
  const startIdx = Math.min(...used.map((p) => p.idx));
  const len = baseIdx - startIdx + 1;

  const series = new Map<string, number[]>();
  for (const p of used) {
    const key = `${p.productId}|${p.channel}`;
    if (!series.has(key)) series.set(key, Array(len).fill(0));
    series.get(key)![p.idx - startIdx] += p.units;
  }

  const r2 = (v: number) => Math.round(v * 100) / 100;
  const rows: ForecastRow[] = [];
  for (const [key, raw] of series) {
    const [productId, channel] = key.split("|") as [string, ForecastChannel];
    const f = forecastSeries(raw, channel, h);
    if (!f) continue;
    for (let k = 1; k <= h; k++) {
      const t = fromMonthIndex(baseIdx + k);
      rows.push({
        product_id: productId,
        channel,
        horizon: k,
        target_year: t.year,
        target_month: t.month,
        forecast_units: r2(f.perMonth),
        baseline_units: r2(f.baseline),
        method: f.method,
        backtest_error: f.backtestError == null ? null : Math.round(f.backtestError * 10000) / 10000,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Accuracy: forecast vs actual, measured product by product.

export type AccuracyPair = { forecast: number; baseline: number; actual: number };

export type AccuracySummary = {
  forecast: number;
  actual: number;
  /** 1 − Σ|F−A| / ΣA over products (floored at 0) */
  accuracy: number | null;
  /** (ΣF − ΣA) / ΣA — positive = over-forecast */
  bias: number | null;
  /** same accuracy for the plain 3-month average */
  baselineAccuracy: number | null;
  products: number;
};

export function summarizeAccuracy(pairs: AccuracyPair[]): AccuracySummary {
  let f = 0;
  let a = 0;
  let err = 0;
  let bErr = 0;
  for (const p of pairs) {
    f += p.forecast;
    a += p.actual;
    err += Math.abs(p.forecast - p.actual);
    bErr += Math.abs(p.baseline - p.actual);
  }
  return {
    forecast: f,
    actual: a,
    accuracy: a > 0 ? Math.max(0, 1 - err / a) : null,
    bias: a > 0 ? (f - a) / a : null,
    baselineAccuracy: a > 0 ? Math.max(0, 1 - bErr / a) : null,
    products: pairs.length,
  };
}
