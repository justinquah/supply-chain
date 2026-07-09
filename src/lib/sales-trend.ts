// Shared sales-trend momentum helpers — used by the Sales Trend page (insights)
// and the trend table (per-row badges/sparklines) so both agree.

export type Momentum = {
  dir: "up" | "down" | "flat";
  /** fractional growth of the recent window vs the prior window (null if not meaningful) */
  growthPct: number | null;
  recentAvg: number;
  priorAvg: number;
  /** true when both windows are too small to judge (avoid noise on tiny numbers) */
  quiet: boolean;
};

const MIN_VOL = 5; // ignore momentum on very small numbers

/**
 * Classify a monthly series (oldest → newest). Compares the average of the most
 * recent window to the window before it. Window = up to 3 months.
 */
export function computeMomentum(series: number[]): Momentum {
  const n = series.length;
  if (n === 0) return { dir: "flat", growthPct: null, recentAvg: 0, priorAvg: 0, quiet: true };
  const w = Math.max(1, Math.min(3, Math.floor(n / 2)));
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const recent = avg(series.slice(n - w));
  const prior = avg(series.slice(Math.max(0, n - 2 * w), n - w));

  if (recent < MIN_VOL && prior < MIN_VOL) {
    return { dir: "flat", growthPct: null, recentAvg: recent, priorAvg: prior, quiet: true };
  }
  const growthPct = prior > 0 ? (recent - prior) / prior : recent > 0 ? 1 : 0;
  const dir = growthPct >= 0.15 ? "up" : growthPct <= -0.15 ? "down" : "flat";
  return { dir, growthPct: prior > 0 ? growthPct : null, recentAvg: recent, priorAvg: prior, quiet: false };
}

/** Format a fractional growth like 0.42 → "+42%". */
export function fmtGrowth(g: number | null): string {
  if (g == null) return "new";
  const pct = Math.round(g * 100);
  return (pct >= 0 ? "+" : "") + pct + "%";
}
