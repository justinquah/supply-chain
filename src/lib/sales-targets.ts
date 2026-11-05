// Monthly sales target status — pure helpers shared by the Targets view.
//
// Once a month's sales for a channel are uploaded, a target is Achieved or
// Missed against the actual. Before that, it's On track or At risk against
// the forecast for that month.

export type TargetStatus = "achieved" | "missed" | "on_track" | "at_risk" | "no_data" | "no_target";

export type ChannelProgress = {
  target: number | null;
  /** actual units, null while the month's sales for this channel aren't in */
  actual: number | null;
  /** forecast units for the month (null when none) */
  forecast: number | null;
};

export type StatusResult = {
  status: TargetStatus;
  /** actual (or forecast) as a fraction of target */
  pct: number | null;
  /** actual (or forecast) − target; negative = short */
  gap: number | null;
  /** true when judged on the forecast, not the actual */
  projected: boolean;
};

export function targetStatus({ target, actual, forecast }: ChannelProgress): StatusResult {
  if (target == null) return { status: "no_target", pct: null, gap: null, projected: false };
  const pctOf = (v: number) => (target > 0 ? v / target : v > 0 ? 1 : 0);
  if (actual != null) {
    return {
      status: actual >= target ? "achieved" : "missed",
      pct: pctOf(actual),
      gap: actual - target,
      projected: false,
    };
  }
  if (forecast != null) {
    return {
      status: forecast >= target ? "on_track" : "at_risk",
      pct: pctOf(forecast),
      gap: forecast - target,
      projected: true,
    };
  }
  return { status: "no_data", pct: null, gap: null, projected: true };
}

// Worst first — a product's overall status is its worst channel.
const SEVERITY: TargetStatus[] = ["missed", "at_risk", "no_data", "on_track", "achieved", "no_target"];

export function worstStatus(statuses: TargetStatus[]): TargetStatus {
  for (const s of SEVERITY) if (statuses.includes(s)) return s;
  return "no_target";
}

export function statusRank(s: TargetStatus): number {
  return SEVERITY.indexOf(s);
}

export const STATUS_LABEL: Record<TargetStatus, string> = {
  achieved: "Achieved",
  missed: "Not achieved",
  on_track: "On track",
  at_risk: "At risk",
  no_data: "No forecast",
  no_target: "No target",
};

export const STATUS_CLASS: Record<TargetStatus, string> = {
  achieved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  missed: "bg-red-50 text-red-700 border-red-200",
  on_track: "bg-sky-50 text-sky-700 border-sky-200",
  at_risk: "bg-amber-50 text-amber-800 border-amber-200",
  no_data: "bg-gray-50 text-gray-500 border-gray-200",
  no_target: "bg-gray-50 text-gray-400 border-gray-200",
};
