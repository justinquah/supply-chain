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

export function computeScmScore(i: ScmScoreInput): ScmScore {
  const oos = i.oosPct ?? 0;
  const healthy = i.healthyPct ?? 0;
  const overstock = i.overstockPct ?? 0;

  // 1. Availability (30%) — OOS 0% = 100, 10% = 0.
  const availability = clamp(100 - oos * 10);
  // 2. Stock health (25%) — Healthy 80%+ = 100.
  const health = clamp((healthy / 80) * 100);
  // 3. Capital efficiency (25%) — ≤20% overstock = 100, penalise beyond.
  const efficiency = clamp(100 - Math.max(0, overstock - 20) * 1.5);
  // 4. PO coordination (20%) — reorder discipline + delay management.
  const reorderScore = i.lowStock > 0 ? ((i.lowStock - i.lowNoPo) / i.lowStock) * 100 : 100;
  const delayScore = i.overdue > 0 ? (i.overdueManaged / i.overdue) * 100 : 100;
  const coordination = clamp((reorderScore + delayScore) / 2);

  const pct = (v: number) => Math.round(v);
  const pillars: Pillar[] = [
    {
      key: "availability",
      label: "Availability",
      weight: 30,
      metric: `OOS ${pct(oos)}%`,
      score: availability,
      weighted: (availability * 30) / 100,
    },
    {
      key: "health",
      label: "Stock health",
      weight: 25,
      metric: `Healthy ${pct(healthy)}%`,
      score: health,
      weighted: (health * 25) / 100,
    },
    {
      key: "efficiency",
      label: "Capital efficiency",
      weight: 25,
      metric: `Overstock ${pct(overstock)}%`,
      score: efficiency,
      weighted: (efficiency * 25) / 100,
    },
    {
      key: "coordination",
      label: "PO coordination",
      weight: 20,
      metric: `${i.lowStock - i.lowNoPo}/${i.lowStock} reorders covered · ${i.overdueManaged}/${i.overdue} overdue managed`,
      score: coordination,
      weighted: (coordination * 20) / 100,
    },
  ];

  const total = pillars.reduce((s, p) => s + p.weighted, 0);
  const g = gradeOf(total);
  return { pillars, total, grade: g.grade, gradeLabel: g.label };
}
