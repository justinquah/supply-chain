"use client";

// Demand uplift callout for the Insights page. The stock plan runs on trailing
// 3-month averages (AMS), so a real demand shift is absorbed months late. When
// a product's last completed month runs >= +20% above the average of the 3
// months before it (per channel), a row appears here and the SCM asks the
// Online/Offline team: short-term uplift (promo — no stock action) or
// long-term uplift (raise the stock plan / consider an extra PO). Verdicts are
// stored in demand_signals; "Undo" deletes the row so it returns to pending.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  resolveDemandSignal,
  undoDemandSignal,
  type DemandChannel,
  type DemandResolution,
} from "@/app/(authed)/insights/actions";

export type DemandUpliftRow = {
  productId: string;
  /** Display label: variation || name. */
  label: string;
  family: string | null;
  channel: DemandChannel;
  /** Units in the last completed month. */
  lastUnits: number;
  /** Average of the 3 months strictly before it. */
  baseline: number;
  /** e.g. 68.6 for +68.6%. */
  upliftPct: number;
  /** lastUnits - baseline (absolute extra units — the sort key). */
  extraUnits: number;
  /** Verdict, when a demand_signals row exists for (product, period, channel). */
  resolution: DemandResolution | null;
  note: string | null;
};

function num(v: number, dp = 0) {
  return Number(v).toLocaleString("en-MY", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

function ChannelChip({ channel }: { channel: DemandChannel }) {
  const cls =
    channel === "ONLINE"
      ? "bg-sky-50 text-sky-700"
      : "bg-violet-50 text-violet-700";
  return (
    <span
      className={
        "inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium shrink-0 " +
        cls
      }
    >
      {channel}
    </span>
  );
}

export function DemandUplift({
  rows,
  period,
  monthLabel,
  canAct,
}: {
  rows: DemandUpliftRow[];
  /** First day of the spiking month, YYYY-MM-DD. */
  period: string;
  /** e.g. "Jun 2026". */
  monthLabel: string;
  /** SCM/ADMIN only — they can record / undo verdicts. */
  canAct: boolean;
}) {
  const pending = rows.filter((r) => r.resolution == null);
  const resolved = rows.filter((r) => r.resolution != null);
  const [showResolved, setShowResolved] = useState(false);
  const monthShort = monthLabel.split(" ")[0];

  return (
    <div className="rounded-lg border border-gray-200 border-l-4 border-l-amber-400 p-3 bg-white">
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        <div className="text-sm font-medium text-gray-800">
          Demand uplift — check with sales teams ({pending.length})
        </div>
      </div>
      <div className="text-[11px] text-gray-400 mb-2 ml-3.5">
        ≥20% above the prior 3-month average · {monthLabel} (last completed
        month)
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-gray-400 py-1">
          No product is running ≥20% above its 3-month average — nothing to
          check.
        </p>
      ) : (
        <>
          {pending.length > 0 && (
            <ul className="space-y-2 max-h-96 overflow-y-auto">
              {pending.map((r) => (
                <PendingRow
                  key={r.productId + r.channel}
                  row={r}
                  period={period}
                  monthShort={monthShort}
                  canAct={canAct}
                />
              ))}
            </ul>
          )}

          {resolved.length > 0 && (
            <div className={pending.length > 0 ? "mt-3 border-t border-gray-100 pt-2" : ""}>
              <button
                type="button"
                onClick={() => setShowResolved((v) => !v)}
                className="text-[11px] font-medium text-gray-400 hover:text-gray-600"
              >
                {showResolved ? "▾" : "▸"} Resolved ({resolved.length})
              </button>
              {showResolved && (
                <ul className="mt-1 space-y-2">
                  {resolved.map((r) => (
                    <ResolvedRow
                      key={r.productId + r.channel}
                      row={r}
                      period={period}
                      monthShort={monthShort}
                      canAct={canAct}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// One pending spike: product + channel + figures, and (SCM/ADMIN) the verdict
// buttons plus an optional "what did the team say?" note.
function PendingRow({
  row,
  period,
  monthShort,
  canAct,
}: {
  row: DemandUpliftRow;
  period: string;
  monthShort: string;
  canAct: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function resolve(resolution: DemandResolution) {
    setErr(null);
    startTransition(async () => {
      const res = await resolveDemandSignal({
        productId: row.productId,
        period,
        channel: row.channel,
        upliftPct: row.upliftPct,
        resolution,
        note: note.trim() || undefined,
      });
      if (res.ok) router.refresh();
      else setErr(res.error ?? "Failed to save");
    });
  }

  return (
    <li className="rounded-md bg-gray-50 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-800 truncate">
            {row.label}
          </div>
          {row.family && (
            <div className="text-[10px] text-gray-400 truncate">
              {row.family}
            </div>
          )}
        </div>
        <ChannelChip channel={row.channel} />
      </div>

      <div className="mt-1 text-xs text-gray-600 tabular-nums">
        {monthShort}: {num(row.lastUnits)} u · avg {num(row.baseline)} · +
        {num(row.upliftPct, 1)}% (+{num(row.extraUnits)} u)
      </div>

      {canAct && (
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          <input
            type="text"
            value={note}
            disabled={isPending}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What did the team say?"
            className="border border-gray-300 rounded-md px-1.5 py-0.5 text-xs flex-1 min-w-32 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => resolve("SHORT_TERM")}
            disabled={isPending}
            className="rounded-md bg-gray-200 text-gray-700 px-2 py-0.5 text-[11px] font-medium hover:bg-gray-300 disabled:opacity-50"
          >
            Short-term uplift
          </button>
          <button
            type="button"
            onClick={() => resolve("LONG_TERM")}
            disabled={isPending}
            className="rounded-md bg-indigo-50 text-indigo-700 px-2 py-0.5 text-[11px] font-medium hover:bg-indigo-100 disabled:opacity-50"
          >
            Long-term uplift
          </button>
          {err && <span className="text-[10px] text-red-600">{err}</span>}
        </div>
      )}
    </li>
  );
}

// One resolved spike: verdict chip + note, and (SCM/ADMIN) an Undo button that
// deletes the demand_signals row so the spike returns to pending.
function ResolvedRow({
  row,
  period,
  monthShort,
  canAct,
}: {
  row: DemandUpliftRow;
  period: string;
  monthShort: string;
  canAct: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function undo() {
    setErr(null);
    startTransition(async () => {
      const res = await undoDemandSignal(row.productId, period, row.channel);
      if (res.ok) router.refresh();
      else setErr(res.error ?? "Failed to undo");
    });
  }

  const longTerm = row.resolution === "LONG_TERM";

  return (
    <li className="rounded-md bg-gray-50 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm text-gray-700 truncate">{row.label}</div>
          <div className="text-[10px] text-gray-400 truncate tabular-nums">
            {row.family ? row.family + " · " : ""}
            {monthShort}: {num(row.lastUnits)} u · avg {num(row.baseline)} · +
            {num(row.upliftPct, 1)}%
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <ChannelChip channel={row.channel} />
          {canAct && (
            <button
              type="button"
              onClick={undo}
              disabled={isPending}
              className="text-[10px] text-gray-400 hover:text-gray-600 underline disabled:opacity-50"
            >
              {isPending ? "…" : "Undo"}
            </button>
          )}
        </div>
      </div>

      <div className="mt-1">
        {longTerm ? (
          <>
            <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium bg-indigo-50 text-indigo-700">
              Long-term — plan stock at ~{num(row.lastUnits)} u/mo
            </span>
            <div className="text-[11px] text-gray-400 mt-0.5">
              Consider an extra PO if coverage was sized on the old average.
            </div>
          </>
        ) : (
          <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500">
            Short-term — no stock action (promo-driven)
          </span>
        )}
        {row.note && (
          <div className="text-[11px] text-gray-500 mt-0.5">
            &ldquo;{row.note}&rdquo;
          </div>
        )}
        {err && <div className="text-[10px] text-red-600 mt-0.5">{err}</div>}
      </div>
    </li>
  );
}
