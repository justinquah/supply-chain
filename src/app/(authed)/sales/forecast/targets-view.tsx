import type { ReactNode } from "react";
import Link from "next/link";
import type { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchAll } from "@/lib/fetch-all";
import { fromMonthIndex, monthIndex, type ForecastChannel } from "@/lib/forecast";
import type { ForecastData } from "@/lib/forecast-store";
import {
  statusRank,
  targetStatus,
  worstStatus,
  type StatusResult,
  type TargetStatus,
} from "@/lib/sales-targets";
import { cn } from "@/lib/utils";
import {
  AddFocusProduct,
  ChannelTargetsForm,
  FocusRow,
  ResultCell,
  StatusPill,
  type FocusOption,
  type FocusRowData,
} from "./targets-editor";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const label = (idx: number) => {
  const t = fromMonthIndex(idx);
  return `${MONTHS[t.month]} ${t.year}`;
};
const param = (idx: number) => {
  const t = fromMonthIndex(idx);
  return `${t.year}-${String(t.month).padStart(2, "0")}`;
};
const n = (v: number) => Math.round(v).toLocaleString("en-MY");
const CHANNELS: ForecastChannel[] = ["ONLINE", "OFFLINE"];
const CH_LABEL: Record<ForecastChannel, string> = { ONLINE: "Online", OFFLINE: "Offline" };

/** Parse ?m=YYYY-MM into a month index. */
export function parseTargetMonth(m: string | undefined): number | null {
  const hit = m?.match(/^(\d{4})-(\d{1,2})$/);
  if (!hit) return null;
  const y = Number(hit[1]);
  const mo = Number(hit[2]);
  return mo >= 1 && mo <= 12 && y >= 2000 && y <= 2100 ? monthIndex(y, mo) : null;
}

type FocusDbRow = {
  year: number;
  month: number;
  product_id: string;
  online_target: number | null;
  offline_target: number | null;
  review_note: string | null;
  products: { name: string; variation: string | null; product_family: string | null; sku: string } | null;
};

export async function TargetsView({
  supabase,
  data,
  requested,
  canEdit,
}: {
  supabase: Supabase;
  data: ForecastData;
  requested: number | null;
  canEdit: boolean;
}) {
  const { latestBase, live, saved, points, products, channelTotals } = data;

  // Default month: the one after the latest complete month (the month in progress).
  const now = new Date();
  const anchor = latestBase ?? monthIndex(now.getFullYear(), now.getMonth() + 1) - 1;
  const sel = requested ?? anchor + 1;
  const chipSet = new Set<number>();
  for (let i = anchor - 5; i <= anchor + 3; i++) chipSet.add(i);
  chipSet.add(sel);
  const chips = [...chipSet].sort((a, b) => a - b);

  // ---- Targets (all months in the chip window) ----
  const lo = fromMonthIndex(chips[0]);
  const hi = fromMonthIndex(chips[chips.length - 1]);
  const inWindow = (y: number, m: number) => {
    const i = monthIndex(y, m);
    return i >= chips[0] && i <= chips[chips.length - 1];
  };
  const [{ data: chRows }, { data: focusRows }] = await Promise.all([
    supabase
      .from("sales_channel_targets")
      .select("year, month, channel, target_units")
      .gte("year", lo.year)
      .lte("year", hi.year),
    fetchAll((from, to) =>
      supabase
        .from("sales_focus_targets")
        .select(
          "year, month, product_id, online_target, offline_target, review_note, products(name, variation, product_family, sku)"
        )
        .gte("year", lo.year)
        .lte("year", hi.year)
        .order("id", { ascending: true })
        .range(from, to)
    ),
  ]);

  const channelTarget = new Map<string, number>(); // `${idx}|${ch}`
  for (const r of (chRows ?? []) as any[]) {
    if (!inWindow(r.year, r.month)) continue;
    channelTarget.set(`${monthIndex(r.year, r.month)}|${r.channel}`, Number(r.target_units));
  }
  const focusByMonth = new Map<number, FocusDbRow[]>();
  for (const r of (focusRows ?? []) as unknown as FocusDbRow[]) {
    if (!inWindow(r.year, r.month)) continue;
    const i = monthIndex(r.year, r.month);
    if (!focusByMonth.has(i)) focusByMonth.set(i, []);
    focusByMonth.get(i)!.push(r);
  }

  // ---- Actuals & forecasts ----
  const hasChannel = (idx: number, c: ForecastChannel) => (channelTotals.get(idx)?.[c] ?? 0) > 0;
  const productActual = new Map<string, number>();
  for (const p of points) {
    const k = `${p.productId}|${p.channel}|${p.idx}`;
    productActual.set(k, (productActual.get(k) || 0) + p.units);
  }
  // Future months: the live forecast. Past months: what was forecast a month ahead.
  const forecastFor = (pid: string | null, c: ForecastChannel, idx: number): number | null => {
    const src =
      latestBase != null && idx > latestBase
        ? live.filter((r) => monthIndex(r.target_year, r.target_month) === idx)
        : saved.filter((r) => r.horizon === 1 && monthIndex(r.target_year, r.target_month) === idx);
    const rows = src.filter((r) => r.channel === c && (pid == null || r.product_id === pid));
    if (!src.length) return null;
    return rows.reduce((s, r) => s + r.forecast_units, 0);
  };
  const channelProgress = (idx: number, c: ForecastChannel): StatusResult & { value: number | null } => {
    const target = channelTarget.get(`${idx}|${c}`) ?? null;
    const actual = hasChannel(idx, c) ? channelTotals.get(idx)![c] : null;
    const forecast = forecastFor(null, c, idx);
    const s = targetStatus({ target, actual, forecast });
    return { ...s, value: actual ?? forecast };
  };
  const num = (v: unknown) => (v == null ? null : Number(v));
  const focusStatus = (idx: number, r: FocusDbRow) => {
    const per = {} as Record<ForecastChannel, { target: number | null; value: number | null; s: StatusResult; hint: number | null }>;
    for (const c of CHANNELS) {
      const target = num(c === "ONLINE" ? r.online_target : r.offline_target);
      const actual = hasChannel(idx, c) ? productActual.get(`${r.product_id}|${c}|${idx}`) || 0 : null;
      const forecast = forecastFor(r.product_id, c, idx);
      per[c] = { target, value: actual ?? forecast, s: targetStatus({ target, actual, forecast }), hint: forecast };
    }
    return { per, overall: worstStatus(CHANNELS.map((c) => per[c].s.status)) };
  };

  // ---- Selected month ----
  const selT = fromMonthIndex(sel);
  const selFocus = (focusByMonth.get(sel) ?? []).map((r) => {
    const st = focusStatus(sel, r);
    const p = r.products;
    const row: FocusRowData = {
      productId: r.product_id,
      label: p?.variation || p?.name || "Unknown product",
      family: p?.product_family || p?.name || "",
      sku: p?.sku || "",
      online: st.per.ONLINE,
      offline: st.per.OFFLINE,
      overall: st.overall,
      note: r.review_note,
    };
    return row;
  });
  selFocus.sort(
    (a, b) =>
      statusRank(a.overall) - statusRank(b.overall) ||
      (a.online.s.gap ?? 0) + (a.offline.s.gap ?? 0) - ((b.online.s.gap ?? 0) + (b.offline.s.gap ?? 0))
  );
  const counts = new Map<TargetStatus, number>();
  for (const r of selFocus) counts.set(r.overall, (counts.get(r.overall) || 0) + 1);

  const focusIds = new Set(selFocus.map((r) => r.productId));
  const options: FocusOption[] = products
    .filter((p) => !focusIds.has(p.id))
    .map((p) => ({
      id: p.id,
      label: `${p.product_family || p.name} · ${p.variation || p.name}`,
      hintOnline: forecastFor(p.id, "ONLINE", sel),
      hintOffline: forecastFor(p.id, "OFFLINE", sel),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const progress = { ONLINE: channelProgress(sel, "ONLINE"), OFFLINE: channelProgress(sel, "OFFLINE") };
  const onIn = hasChannel(sel, "ONLINE");
  const offIn = hasChannel(sel, "OFFLINE");
  const stateText =
    onIn && offIn
      ? "Sales uploaded — final result"
      : onIn || offIn
      ? `${onIn ? "Online" : "Offline"} sales uploaded; ${onIn ? "offline" : "online"} still judged on the forecast`
      : latestBase != null && sel > latestBase && sel <= latestBase + 3
      ? "In progress — judged against the forecast until the month's sales are uploaded"
      : latestBase != null && sel > latestBase + 3
      ? "Beyond the 3-month forecast — status shows once it's in range"
      : "No sales uploaded for this month";

  const sumTargets = (c: "online" | "offline") =>
    selFocus.reduce((s, r) => s + (r[c].target ?? 0), 0);
  const coverage = CHANNELS.map((c) => {
    const focusSum = sumTargets(c === "ONLINE" ? "online" : "offline");
    const total = channelTarget.get(`${sel}|${c}`) ?? null;
    return { c, focusSum, total };
  });

  // ---- History ----
  const history = chips
    .filter(
      (i) => CHANNELS.some((c) => channelTarget.has(`${i}|${c}`)) || (focusByMonth.get(i)?.length ?? 0) > 0
    )
    .sort((a, b) => b - a)
    .map((i) => {
      const fc = new Map<TargetStatus, number>();
      for (const r of focusByMonth.get(i) ?? []) {
        const s = focusStatus(i, r).overall;
        fc.set(s, (fc.get(s) || 0) + 1);
      }
      return {
        idx: i,
        on: channelProgress(i, "ONLINE"),
        off: channelProgress(i, "OFFLINE"),
        focus: fc,
        focusTotal: focusByMonth.get(i)?.length ?? 0,
      };
    });

  const prevLabel = label(sel - 1);

  return (
    <div className="space-y-6">
      {/* Month picker */}
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((i) => {
          const hasTargets =
            CHANNELS.some((c) => channelTarget.has(`${i}|${c}`)) || (focusByMonth.get(i)?.length ?? 0) > 0;
          const future = latestBase != null && i > latestBase;
          return (
            <Link
              key={i}
              href={`/sales/forecast?view=targets&m=${param(i)}`}
              className={cn(
                "px-2.5 py-1 rounded-md text-sm border transition-colors",
                i === sel
                  ? "bg-brand text-white border-brand"
                  : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50",
                future && i !== sel && "border-dashed"
              )}
              title={future ? "Upcoming — compared with the forecast" : "Sales uploaded"}
            >
              {label(i)}
              {hasTargets && (
                <span
                  className={cn(
                    "ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle",
                    i === sel ? "bg-white" : "bg-brand"
                  )}
                />
              )}
            </Link>
          );
        })}
      </div>

      {/* Channel targets */}
      <Card>
        <CardHeader>
          <CardTitle>
            {FULL[selT.month]} {selT.year} — channel targets
          </CardTitle>
          <p className="text-xs text-gray-500 mt-1">{stateText}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {CHANNELS.map((c) => {
              const p = progress[c];
              return (
                <div key={c} className="rounded-lg border border-gray-200 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs uppercase tracking-wide text-gray-500">{CH_LABEL[c]}</div>
                    <StatusPill status={p.status} />
                  </div>
                  <div className="mt-2 flex items-end justify-between gap-3">
                    <div>
                      <div className="text-[11px] text-gray-400">Target</div>
                      <div className="text-xl font-semibold tabular-nums">
                        {p.status === "no_target" ? "—" : n(channelTarget.get(`${sel}|${c}`)!)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] text-gray-400">
                        {p.projected ? "Forecast" : "Actual"}
                      </div>
                      <ResultCell value={p.value} s={p} />
                    </div>
                  </div>
                </div>
              );
            })}
            <TotalCard on={progress.ONLINE} off={progress.OFFLINE} targets={[
              channelTarget.get(`${sel}|ONLINE`) ?? null,
              channelTarget.get(`${sel}|OFFLINE`) ?? null,
            ]} />
          </div>
          {canEdit && (
            <ChannelTargetsForm
              key={`ch-${sel}`}
              year={selT.year}
              month={selT.month}
              online={channelTarget.get(`${sel}|ONLINE`) ?? null}
              offline={channelTarget.get(`${sel}|OFFLINE`) ?? null}
            />
          )}
        </CardContent>
      </Card>

      {/* Focus products */}
      <Card>
        <CardHeader>
          <CardTitle>Focus products — {label(sel)}</CardTitle>
          <p className="text-xs text-gray-500 mt-1">
            {selFocus.length === 0
              ? "No focus products for this month yet."
              : [
                  `${selFocus.length} focus product${selFocus.length === 1 ? "" : "s"}`,
                  counts.get("missed") ? `${counts.get("missed")} not achieved` : null,
                  counts.get("at_risk") ? `${counts.get("at_risk")} at risk` : null,
                  counts.get("achieved") ? `${counts.get("achieved")} achieved` : null,
                  counts.get("on_track") ? `${counts.get("on_track")} on track` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
            {coverage.some((x) => x.total != null && x.focusSum > 0) && (
              <>
                {" — focus targets cover "}
                {coverage
                  .filter((x) => x.total != null && x.focusSum > 0)
                  .map((x) => (
                    <span
                      key={x.c}
                      className={cn(x.focusSum > (x.total ?? 0) && "text-red-600 font-medium")}
                      title={
                        x.focusSum > (x.total ?? 0)
                          ? `Focus ${CH_LABEL[x.c].toLowerCase()} targets add up to more than the channel target`
                          : undefined
                      }
                    >
                      {Math.round((x.focusSum / Math.max(1, x.total!)) * 100)}% of{" "}
                      {CH_LABEL[x.c].toLowerCase()}
                    </span>
                  ))
                  .reduce<ReactNode[]>((acc, el, i) => (i ? [...acc, ", ", el] : [el]), [])}
              </>
            )}
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {canEdit && (
            <div className="px-4 pb-3">
              <AddFocusProduct
                key={`add-${sel}`}
                year={selT.year}
                month={selT.month}
                options={options}
                prevLabel={prevLabel}
              />
            </div>
          )}
          {selFocus.length > 0 && (
            <div className="overflow-x-auto border-t border-gray-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-gray-500 bg-gray-50">
                    <th className="pt-2 pl-4 pr-3 font-semibold text-left" rowSpan={2}>
                      Product
                    </th>
                    <th className="pt-2 px-3 font-semibold text-center" colSpan={2}>
                      Online
                    </th>
                    <th className="pt-2 px-3 font-semibold text-center border-l border-gray-200" colSpan={2}>
                      Offline
                    </th>
                    <th className="pt-2 px-3 font-semibold text-left border-l border-gray-200" rowSpan={2}>
                      Status
                    </th>
                    <th className="pt-2 px-3 font-semibold text-left" rowSpan={2}>
                      Review note
                    </th>
                    <th rowSpan={2} />
                  </tr>
                  <tr className="text-[10px] text-gray-400 bg-gray-50 border-b border-gray-200">
                    <th className="pb-1.5 px-2 font-normal text-right">Target</th>
                    <th className="pb-1.5 px-3 font-normal text-right">Actual / fcst</th>
                    <th className="pb-1.5 px-2 font-normal text-right border-l border-gray-200">Target</th>
                    <th className="pb-1.5 px-3 font-normal text-right">Actual / fcst</th>
                  </tr>
                </thead>
                <tbody>
                  {selFocus.map((r) => (
                    <FocusRow
                      key={`${sel}-${r.productId}`}
                      year={selT.year}
                      month={selT.month}
                      row={r}
                      canEdit={canEdit}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* History */}
      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Target achievement by month</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-gray-500 bg-gray-50 border-b border-gray-200 text-left">
                  <th className="py-2 pl-4 pr-3 font-semibold">Month</th>
                  <th className="py-2 px-3 font-semibold text-right">Online target</th>
                  <th className="py-2 px-3 font-semibold text-right">Online result</th>
                  <th className="py-2 px-3 font-semibold text-right">Offline target</th>
                  <th className="py-2 px-3 font-semibold text-right">Offline result</th>
                  <th className="py-2 pr-4 pl-3 font-semibold">Focus products</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.idx} className={cn("border-b border-gray-100", h.idx === sel && "bg-brand/5")}>
                    <td className="py-2 pl-4 pr-3">
                      <Link
                        href={`/sales/forecast?view=targets&m=${param(h.idx)}`}
                        className="text-brand hover:underline"
                      >
                        {label(h.idx)}
                      </Link>
                    </td>
                    {[h.on, h.off].map((p, j) => (
                      <HistoryCells key={j} p={p} target={channelTarget.get(`${h.idx}|${CHANNELS[j]}`) ?? null} />
                    ))}
                    <td className="py-2 pr-4 pl-3 text-xs">
                      {h.focusTotal === 0 ? (
                        <span className="text-gray-300">—</span>
                      ) : (
                        <span className="inline-flex flex-wrap gap-1">
                          {(["missed", "at_risk", "achieved", "on_track", "no_target", "no_data"] as TargetStatus[])
                            .filter((s) => h.focus.get(s))
                            .map((s) => (
                              <span key={s} className="inline-flex items-center gap-1">
                                <StatusPill status={s} />
                                <span className="tabular-nums text-gray-600">{h.focus.get(s)}</span>
                              </span>
                            ))}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TotalCard({
  on,
  off,
  targets,
}: {
  on: StatusResult & { value: number | null };
  off: StatusResult & { value: number | null };
  targets: [number | null, number | null];
}) {
  const bothTargets = targets[0] != null && targets[1] != null;
  const target = bothTargets ? targets[0]! + targets[1]! : null;
  const value = on.value != null && off.value != null ? on.value + off.value : null;
  const projected = on.projected || off.projected;
  const s: StatusResult =
    target == null || value == null
      ? { status: target == null ? "no_target" : "no_data", pct: null, gap: null, projected }
      : {
          status: projected ? (value >= target ? "on_track" : "at_risk") : value >= target ? "achieved" : "missed",
          pct: target > 0 ? value / target : null,
          gap: value - target,
          projected,
        };
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-gray-500">Total</div>
        <StatusPill status={s.status} />
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div>
          <div className="text-[11px] text-gray-400">Target</div>
          <div className="text-xl font-semibold tabular-nums">{target == null ? "—" : n(target)}</div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-gray-400">{projected ? "Forecast" : "Actual"}</div>
          <ResultCell value={value} s={s} />
        </div>
      </div>
      {!bothTargets && (
        <div className="text-[11px] text-gray-400 mt-1">Set both channel targets to see the total.</div>
      )}
    </div>
  );
}

function HistoryCells({ p, target }: { p: StatusResult & { value: number | null }; target: number | null }) {
  return (
    <>
      <td className="py-2 px-3 text-right tabular-nums text-gray-600">{target == null ? "—" : n(target)}</td>
      <td className="py-2 px-3">
        {target == null ? (
          <div className="text-right text-gray-300">—</div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <ResultCell value={p.value} s={p} />
            <StatusPill status={p.status} />
          </div>
        )}
      </td>
    </>
  );
}
