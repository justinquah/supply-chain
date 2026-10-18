// Sales-push actions on overstocked products (migration 0050): what the teams
// did (voucher / ads / discount online, trade offer offline) and whether the
// channel's sales moved once that month's sales were keyed in.
//
// Rule: an action is measured on its start month if it started on/before the
// 15th, otherwise on the following month. Result = the product's units on that
// channel in the measure month vs the average of the 3 months before it.
// Improved = +10% or more.

export type PushChannel = "ONLINE" | "OFFLINE";
export type PushMechanic = "VOUCHER" | "ADS_SPEND" | "DISCOUNT" | "TRADE_OFFER";

export const PUSH_MECHANICS: Record<PushChannel, PushMechanic[]> = {
  ONLINE: ["VOUCHER", "ADS_SPEND", "DISCOUNT"],
  OFFLINE: ["TRADE_OFFER"],
};

export const PUSH_MECHANIC_LABELS: Record<PushMechanic, string> = {
  VOUCHER: "Voucher",
  ADS_SPEND: "Ads spend",
  DISCOUNT: "Discount",
  TRADE_OFFER: "Trade offer",
};

export const PUSH_IMPROVE_THRESHOLD = 0.1; // +10% vs the prior 3-month average
export const PUSH_ACTION_WINDOW_DAYS = 90; // an older action no longer counts as "acted on"

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function isPushMechanic(channel: PushChannel, m: string): m is PushMechanic {
  return (PUSH_MECHANICS[channel] as string[]).includes(m);
}

/** On/before the 15th → that month; later → the next month. */
export function measureMonthFor(startISO: string): { year: number; month: number } {
  const [y, m, d] = startISO.split("-").map(Number);
  if (d <= 15) return { year: y, month: m };
  return m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 };
}

export function monthLabel(year: number, month: number) {
  return `${MONTHS[month]} ${year}`;
}

/** The 3 months before (year, month), oldest first. */
export function baselineMonths(year: number, month: number): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  let y = year;
  let m = month;
  for (let i = 0; i < 3; i++) {
    if (m === 1) {
      y -= 1;
      m = 12;
    } else {
      m -= 1;
    }
    out.unshift({ year: y, month: m });
  }
  return out;
}

export type PushActionRecord = {
  id: string;
  productId: string;
  channel: PushChannel;
  mechanic: PushMechanic;
  details: string | null;
  costMyr: number | null;
  startDate: string;
  endDate: string | null;
  measureYear: number;
  measureMonth: number;
  coverageAtAction: number | null;
};

export type PushStatus = "AWAITING" | "IMPROVED" | "NO_IMPROVEMENT";

export type EvaluatedPushAction = PushActionRecord & {
  status: PushStatus;
  measureLabel: string;
  baseline: number | null; // avg units/month on the channel, 3 months before
  result: number | null; // units on the channel in the measure month
  upliftPct: number | null;
};

/**
 * @param unitsOf units for (product, channel, year, month); 0 when none sold
 * @param isLoaded whether that month's sales for the channel have been keyed in
 */
export function evaluatePushAction(
  a: PushActionRecord,
  unitsOf: (productId: string, channel: PushChannel, year: number, month: number) => number,
  isLoaded: (channel: PushChannel, year: number, month: number) => boolean
): EvaluatedPushAction {
  const measureLabel = monthLabel(a.measureYear, a.measureMonth);
  const base = baselineMonths(a.measureYear, a.measureMonth).filter((b) =>
    isLoaded(a.channel, b.year, b.month)
  );
  const baseline = base.length
    ? base.reduce((s, b) => s + unitsOf(a.productId, a.channel, b.year, b.month), 0) / base.length
    : null;

  if (!isLoaded(a.channel, a.measureYear, a.measureMonth)) {
    return { ...a, status: "AWAITING", measureLabel, baseline, result: null, upliftPct: null };
  }

  const result = unitsOf(a.productId, a.channel, a.measureYear, a.measureMonth);
  const upliftPct = baseline && baseline > 0 ? (result - baseline) / baseline : null;
  const improved =
    baseline && baseline > 0 ? result >= baseline * (1 + PUSH_IMPROVE_THRESHOLD) : result > 0;
  return {
    ...a,
    status: improved ? "IMPROVED" : "NO_IMPROVEMENT",
    measureLabel,
    baseline,
    result,
    upliftPct,
  };
}

/**
 * Where an overstocked product stands:
 *   NO_ACTION       — nothing logged in the last 90 days → SCM to log an action
 *   AWAITING        — latest action's measure month not keyed in yet
 *   IMPROVED        — latest action lifted channel sales ≥ 10%
 *   NO_IMPROVEMENT  — latest action didn't → further action needed
 */
export type ProductPushState = "NO_ACTION" | PushStatus;

export function productPushState(actions: EvaluatedPushAction[], todayISO: string): ProductPushState {
  const cutoff = new Date(todayISO + "T00:00:00Z");
  cutoff.setUTCDate(cutoff.getUTCDate() - PUSH_ACTION_WINDOW_DAYS);
  const cutoffISO = cutoff.toISOString().slice(0, 10);
  const recent = actions
    .filter((a) => a.startDate >= cutoffISO)
    .sort((x, y) => (x.startDate < y.startDate ? 1 : -1));
  if (recent.length === 0) return "NO_ACTION";
  // The latest action decides: an earlier win doesn't cover a later miss.
  return recent[0].status;
}

/** Pending for SCM = no action logged, or the last action didn't work. */
export function isPushPending(state: ProductPushState) {
  return state === "NO_ACTION" || state === "NO_IMPROVEMENT";
}
