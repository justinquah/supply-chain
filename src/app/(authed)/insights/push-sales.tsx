"use client";

// "Push sales — overstock" card. Each overstocked product shows whether the
// sales teams have acted (voucher / ads / discount online, trade offer offline)
// and, once the measure month's sales are keyed in, whether that channel's
// sales improved vs the prior 3-month average. SCM/ADMIN log actions here.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSalesPushAction, logSalesPushAction } from "./actions";
import {
  PUSH_MECHANICS,
  PUSH_MECHANIC_LABELS,
  measureMonthFor,
  monthLabel,
  type EvaluatedPushAction,
  type ProductPushState,
  type PushChannel,
} from "@/lib/sales-push";

export type PushRow = {
  productId: string;
  sku: string;
  label: string;
  coverage: number | null;
  stock: number;
  state: ProductPushState;
  actions: EvaluatedPushAction[]; // newest first
};

const OVER = 3;

function n(v: number) {
  return Math.round(v).toLocaleString("en-MY");
}
function cov(c: number | null) {
  return c == null ? "—" : c.toFixed(1) + " mo";
}
function shortDate(iso: string) {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m]}`;
}

function StatePill({ state, action }: { state: ProductPushState; action?: EvaluatedPushAction }) {
  const cfg: Record<ProductPushState, { cls: string; label: string }> = {
    NO_ACTION: { cls: "bg-amber-100 text-amber-700", label: "Pending — log action" },
    AWAITING: {
      cls: "bg-sky-100 text-sky-700",
      label: action ? `Awaiting ${action.measureLabel.split(" ")[0]} sales` : "Awaiting sales",
    },
    IMPROVED: { cls: "bg-emerald-100 text-emerald-700", label: "Improved" },
    NO_IMPROVEMENT: { cls: "bg-red-100 text-red-700", label: "Further action needed" },
  };
  const c = cfg[state];
  return (
    <span className={"text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 " + c.cls}>
      {c.label}
    </span>
  );
}

const SORT: Record<ProductPushState, number> = {
  NO_IMPROVEMENT: 0,
  NO_ACTION: 1,
  AWAITING: 2,
  IMPROVED: 3,
};

export function PushSalesCard({
  overstock,
  tracked,
  canAct,
  todayISO,
}: {
  overstock: PushRow[];
  tracked: PushRow[];
  canAct: boolean;
  todayISO: string;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const rows = [...overstock].sort(
    (a, b) => SORT[a.state] - SORT[b.state] || (b.coverage ?? 0) - (a.coverage ?? 0)
  );
  const count = (s: ProductPushState) => overstock.filter((r) => r.state === s).length;
  const pending = count("NO_ACTION") + count("NO_IMPROVEMENT");

  return (
    <div className="rounded-lg border border-gray-200 border-l-4 border-l-amber-400 p-3 bg-white">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          <div className="text-sm font-medium text-gray-800">
            Push sales — overstock &gt; {OVER} mo ({overstock.length})
          </div>
        </div>
        {canAct && overstock.length > 0 && !formOpen && (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="text-[11px] font-medium text-brand hover:underline shrink-0"
          >
            + Log action
          </button>
        )}
      </div>
      <div className="text-[11px] text-gray-400 mb-2 ml-3.5">
        {pending} pending · {count("AWAITING")} awaiting sales · {count("IMPROVED")} improving ·
        judged on the channel&rsquo;s sales vs its 3-month average (+10% = improved)
      </div>

      {formOpen && (
        <LogActionForm
          products={rows}
          todayISO={todayISO}
          onClose={() => setFormOpen(false)}
        />
      )}

      {overstock.length === 0 ? (
        <p className="text-xs text-gray-400 py-1">No ranges heavily overstocked.</p>
      ) : (
        <ul className="divide-y divide-gray-100 max-h-[28rem] overflow-y-auto">
          {rows.map((r) => (
            <PushProductRow key={r.productId} row={r} canAct={canAct} />
          ))}
        </ul>
      )}

      {tracked.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-2">
          <div className="text-[11px] font-medium text-gray-400 mb-1">
            Back under {OVER} mo after an action ({tracked.length})
          </div>
          <ul className="divide-y divide-gray-100">
            {tracked.map((r) => (
              <PushProductRow key={r.productId} row={r} canAct={canAct} muted />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PushProductRow({ row, canAct, muted }: { row: PushRow; canAct: boolean; muted?: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const latest = row.actions[0];
  const shown = showAll ? row.actions : row.actions.slice(0, 1);
  return (
    <li className={"py-1.5 " + (muted ? "opacity-75" : "")}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs text-gray-700 font-mono truncate" title={row.label}>
            {row.sku}
          </span>
          <StatePill state={row.state} action={latest} />
        </span>
        <span className="text-xs text-gray-500 tabular-nums whitespace-nowrap">
          {cov(row.coverage)} · {n(row.stock)} u
        </span>
      </div>
      {shown.map((a) => (
        <ActionLine key={a.id} a={a} coverageNow={row.coverage} canAct={canAct} />
      ))}
      {row.actions.length > 1 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-[10px] text-gray-400 hover:text-gray-700 mt-0.5"
        >
          {showAll ? "Hide earlier actions" : `+${row.actions.length - 1} earlier action${row.actions.length > 2 ? "s" : ""}`}
        </button>
      )}
    </li>
  );
}

function ActionLine({
  a,
  coverageNow,
  canAct,
}: {
  a: EvaluatedPushAction;
  coverageNow: number | null;
  canAct: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function remove() {
    if (!window.confirm("Delete this logged action?")) return;
    setErr(null);
    startTransition(async () => {
      const res = await deleteSalesPushAction(a.id);
      if (res.ok) router.refresh();
      else setErr(res.error ?? "Failed to delete");
    });
  }

  let result: React.ReactNode;
  if (a.status === "AWAITING") {
    result = <span className="text-sky-700">measured on {a.measureLabel} sales — not keyed in yet</span>;
  } else {
    const pct = a.upliftPct == null ? null : Math.round(a.upliftPct * 100);
    result = (
      <span className={a.status === "IMPROVED" ? "text-emerald-700" : "text-red-600"}>
        {a.measureLabel}: {n(a.result ?? 0)} u vs {a.baseline == null ? "—" : n(a.baseline)} avg
        {pct != null && ` (${pct >= 0 ? "+" : ""}${pct}%)`}
        {a.status === "NO_IMPROVEMENT" && " — further action needed"}
      </span>
    );
  }

  return (
    <div className="mt-0.5 text-[11px] text-gray-500 leading-snug">
      <span className="font-medium text-gray-600">{PUSH_MECHANIC_LABELS[a.mechanic]}</span>
      <span className="text-gray-400"> · {a.channel === "ONLINE" ? "Online" : "Offline"}</span>
      {a.details && <span> · {a.details}</span>}
      {a.costMyr != null && <span> · RM {n(a.costMyr)}</span>}
      <span className="text-gray-400">
        {" "}· from {shortDate(a.startDate)}
        {a.endDate ? ` to ${shortDate(a.endDate)}` : ""}
      </span>
      {canAct && (
        <button
          type="button"
          onClick={remove}
          disabled={isPending}
          title="Delete this action"
          className="ml-1.5 text-gray-300 hover:text-red-600 disabled:opacity-50"
        >
          ×
        </button>
      )}
      <div>
        {result}
        <span className="text-gray-400">
          {" "}· cover {cov(a.coverageAtAction)} → {cov(coverageNow)}
        </span>
      </div>
      {err && <div className="text-red-600">{err}</div>}
    </div>
  );
}

function LogActionForm({
  products,
  todayISO,
  onClose,
}: {
  products: PushRow[];
  todayISO: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [channel, setChannel] = useState<PushChannel>("ONLINE");
  const [mechanic, setMechanic] = useState<string>(PUSH_MECHANICS.ONLINE[0]);
  const [details, setDetails] = useState("");
  const [cost, setCost] = useState("");
  const [startDate, setStartDate] = useState(todayISO);
  const [endDate, setEndDate] = useState("");
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const measure = /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? measureMonthFor(startDate) : null;

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function save() {
    setErr(null);
    if (picked.size === 0) {
      setErr("Tick at least one product");
      return;
    }
    const costNum = cost.trim() === "" ? null : Number(cost);
    if (costNum != null && !Number.isFinite(costNum)) {
      setErr("Cost must be a number");
      return;
    }
    startTransition(async () => {
      const res = await logSalesPushAction({
        productIds: [...picked],
        channel,
        mechanic,
        details,
        costMyr: costNum,
        startDate,
        endDate: endDate || null,
      });
      if (res.ok) {
        onClose();
        router.refresh();
      } else {
        setErr(res.error ?? "Failed to save");
      }
    });
  }

  const inp =
    "border border-gray-300 rounded-md px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-brand/40";

  return (
    <div className="mb-3 rounded-md border border-gray-200 bg-gray-50 p-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-700">Log a sales-push action</span>
        <button type="button" onClick={onClose} className="text-[11px] text-gray-500 hover:text-gray-800">
          Cancel
        </button>
      </div>

      <div>
        <div className="text-[11px] text-gray-500 mb-1">Products ({picked.size} ticked)</div>
        <div className="max-h-32 overflow-y-auto rounded border border-gray-200 bg-white p-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-3">
          {products.map((p) => (
            <label key={p.productId} className="flex items-center gap-1.5 text-[11px] text-gray-700 py-0.5">
              <input type="checkbox" checked={picked.has(p.productId)} onChange={() => toggle(p.productId)} />
              <span className="font-mono truncate" title={p.label}>{p.sku}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] text-gray-500">Channel</span>
          <select
            value={channel}
            onChange={(e) => {
              const ch = e.target.value as PushChannel;
              setChannel(ch);
              setMechanic(PUSH_MECHANICS[ch][0]);
            }}
            className={inp}
          >
            <option value="ONLINE">Online</option>
            <option value="OFFLINE">Offline</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] text-gray-500">Mechanic</span>
          <select value={mechanic} onChange={(e) => setMechanic(e.target.value)} className={inp}>
            {PUSH_MECHANICS[channel].map((m) => (
              <option key={m} value={m}>
                {PUSH_MECHANIC_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 flex-1 min-w-[160px]">
          <span className="text-[11px] text-gray-500">Details</span>
          <input
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder={channel === "ONLINE" ? "e.g. RM5 off min spend RM50" : "e.g. buy 10 free 1"}
            className={inp}
          />
        </label>
        <label className="flex flex-col gap-0.5 w-24">
          <span className="text-[11px] text-gray-500">Cost (RM)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="optional"
            className={inp}
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] text-gray-500">Start</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inp} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] text-gray-500">End (optional)</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inp} />
        </label>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className="rounded-md bg-gray-800 text-white px-2.5 py-1 text-[11px] font-medium hover:bg-gray-700 disabled:opacity-50"
        >
          {isPending ? "Saving…" : `Log for ${picked.size || "…"} product${picked.size === 1 ? "" : "s"}`}
        </button>
        {measure && (
          <span className="text-[11px] text-gray-500">
            Will be measured on <b>{monthLabel(measure.year, measure.month)}</b>{" "}
            {channel === "ONLINE" ? "online" : "offline"} sales
          </span>
        )}
        {err && <span className="text-[11px] text-red-600">{err}</span>}
      </div>
    </div>
  );
}
