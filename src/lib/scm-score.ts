// SCM Performance Score (out of 100) — composite of 4 pillars.
// Design + rationale saved in project memory (scm-scorecard-design).
// PO coordination measures what the SCM CONTROLS (reorder discipline + managing
// delays), NOT delivery outcomes she can't control (supplier/customs/shipping).

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

export type ScmScoreInput = {
  // From the KPI engine (latest month), 0–100 each (null if no KPI month yet)
  oosPct: number | null;
  overstockPct: number | null;
  healthyPct: number | null;
  // Reorder discipline
  lowStock: number; // # products below target coverage
  lowNoPo: number; // …of those, how many have NO incoming PO
  // Delay coordination
  overdue: number; // # in-transit POs past ETA
  overdueManaged: number; // …of those, how many are flagged Delayed / ETA-updated
};

export type Pillar = {
  key: string;
  label: string;
  weight: number; // %
  metric: string; // human-readable raw metric
  score: number; // 0–100
  weighted: number; // score × weight/100
  /** Plain-English diagnosis: why the score is what it is, with the numbers. */
  why: string;
  /** Concrete moves that raise this pillar (empty when already at 100). */
  actions: string[];
};

export type ScmScore = {
  pillars: Pillar[];
  total: number; // 0–100
  grade: string;
  gradeLabel: string;
};

export function gradeOf(total: number): { grade: string; label: string } {
  if (total >= 85) return { grade: "A", label: "Excellent" };
  if (total >= 70) return { grade: "B", label: "Good" };
  if (total >= 55) return { grade: "C", label: "Fair" };
  return { grade: "D", label: "Needs work" };
}

// The three stock-pillar formulas, shared by the composite score and the
// per-week/per-month trend rows so both always agree.
export const availabilityScore = (oosPct: number) => clamp(100 - oosPct * 10);
export const healthScore = (healthyPct: number) => clamp((healthyPct / 80) * 100);
export const efficiencyScore = (overstockPct: number) =>
  clamp(100 - Math.max(0, overstockPct - 20) * 1.5);

/**
 * Stock-only score for a single week or month, on the same /100 scale as the
 * composite: the three stock pillars at their composite weights (30/25/25),
 * renormalised to 100 because PO coordination has no per-period history.
 */
export function computeStockScore(
  oosPct: number,
  overstockPct: number,
  healthyPct: number
): number {
  return (
    (availabilityScore(oosPct) * 30 +
      healthScore(healthyPct) * 25 +
      efficiencyScore(overstockPct) * 25) /
    80
  );
}

export function computeScmScore(i: ScmScoreInput): ScmScore {
  const oos = i.oosPct ?? 0;
  const healthy = i.healthyPct ?? 0;
  const overstock = i.overstockPct ?? 0;

  // 1. Availability (30%) — OOS 0% = 100, 10% = 0.
  const availability = availabilityScore(oos);
  // 2. Stock health (25%) — Healthy 80%+ = 100.
  const health = healthScore(healthy);
  // 3. Capital efficiency (25%) — ≤20% overstock = 100, penalise beyond.
  const efficiency = efficiencyScore(overstock);
  // 4. PO coordination (20%) — reorder discipline + delay management.
  const reorderScore = i.lowStock > 0 ? ((i.lowStock - i.lowNoPo) / i.lowStock) * 100 : 100;
  const delayScore = i.overdue > 0 ? (i.overdueManaged / i.overdue) * 100 : 100;
  const coordination = clamp((reorderScore + delayScore) / 2);

  const pct = (v: number) => Math.round(v);

  // --- Plain-English diagnosis + fixes per pillar (shown on the KPI page) ---
  const availabilityWhy =
    oos > 0
      ? `${pct(oos)}% of eligible SKUs hit zero stock in this period — each 1% out-of-stock costs 10 points (−${pct(100 - availability)} here), and every OOS week is lost sales.`
      : "No SKU was out of stock in this period — full marks.";
  const availabilityActions =
    availability < 100
      ? [
          "Reorder before coverage falls under 1.5 months — the Insights tab's Replenish list is exactly this queue.",
          "Expedite incoming POs for SKUs already at zero (Insights → Expedite tasks).",
          "For new launches, set the launch date so early low sales don't hide a stock-out risk.",
        ]
      : [];

  const healthWhy =
    healthy < 80
      ? `Only ${pct(healthy)}% of SKUs sit in the healthy band (in stock, under 2× a month's sales) against the 80% target — the rest are either starved or overbought (−${pct(100 - health)} pts).`
      : `${pct(healthy)}% of SKUs in the healthy band — at or above the 80% target.`;
  const healthActions =
    health < 100
      ? [
          "Work both tails at once: replenish the understocked list and slow the overstocked one (both live on Insights).",
          "Size orders to ~1.5 months of average sales rather than filling a container beyond need.",
          "Review slow movers monthly and push promotions before they age into overstock.",
        ]
      : [];

  const efficiencyWhy =
    overstock > 20
      ? `${pct(overstock)}% of SKUs carry more than 2 months of sales in stock. Beyond the 20% allowance that ties up cash in inventory instead of funding new POs (−${pct(100 - efficiency)} pts).`
      : `Overstock at ${pct(overstock)}% — within the 20% allowance.`;
  const efficiencyActions =
    efficiency < 100
      ? [
          "Push sales on ranges above 3 months' coverage (Insights → Push sales list).",
          "Delay incoming POs for overstocked SKUs — the Insights Delay tasks propose a later ETA you can send to the supplier.",
          "Trim reorder quantities to shipment sizes that keep coverage near 1.5 months.",
        ]
      : [];

  const unmanaged = Math.max(0, i.overdue - i.overdueManaged);
  const coordParts: string[] = [];
  if (i.lowNoPo > 0)
    coordParts.push(
      `${i.lowNoPo} of ${i.lowStock} low-stock SKUs have no incoming PO`
    );
  if (unmanaged > 0)
    coordParts.push(
      `${unmanaged} of ${i.overdue} overdue POs have no updated ETA or Delayed flag`
    );
  const coordinationWhy = coordParts.length
    ? `${coordParts.join(", and ")} — this measures the coordination the SCM controls, not the delay itself (−${pct(100 - coordination)} pts).`
    : "Every low-stock SKU has an incoming PO and every overdue PO is being managed — full marks.";
  const coordinationActions =
    coordination < 100
      ? [
          "Issue POs for low-stock SKUs with nothing incoming (Insights → New PO suggestions size one shipment for you).",
          "On overdue POs, update the ETA or flag Delayed so the slip is visibly managed.",
          "Use the Email-supplier buttons so the expedite/delay request reaches the supplier the moment you decide.",
        ]
      : [];

  const pillars: Pillar[] = [
    {
      key: "availability",
      label: "Availability",
      weight: 30,
      metric: `OOS ${pct(oos)}%`,
      score: availability,
      weighted: (availability * 30) / 100,
      why: availabilityWhy,
      actions: availabilityActions,
    },
    {
      key: "health",
      label: "Stock health",
      weight: 25,
      metric: `Healthy ${pct(healthy)}%`,
      score: health,
      weighted: (health * 25) / 100,
      why: healthWhy,
      actions: healthActions,
    },
    {
      key: "efficiency",
      label: "Capital efficiency",
      weight: 25,
      metric: `Overstock ${pct(overstock)}%`,
      score: efficiency,
      weighted: (efficiency * 25) / 100,
      why: efficiencyWhy,
      actions: efficiencyActions,
    },
    {
      key: "coordination",
      label: "PO coordination",
      weight: 20,
      metric: `${i.lowStock - i.lowNoPo}/${i.lowStock} reorders covered · ${i.overdueManaged}/${i.overdue} overdue managed`,
      score: coordination,
      weighted: (coordination * 20) / 100,
      why: coordinationWhy,
      actions: coordinationActions,
    },
  ];

  const total = pillars.reduce((s, p) => s + p.weighted, 0);
  const g = gradeOf(total);
  return { pillars, total, grade: g.grade, gradeLabel: g.label };
}
