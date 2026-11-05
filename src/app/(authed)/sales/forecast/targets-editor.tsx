"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { STATUS_CLASS, STATUS_LABEL, type StatusResult, type TargetStatus } from "@/lib/sales-targets";
import {
  copyFocusFromPreviousMonth,
  removeFocusProduct,
  saveChannelTargets,
  saveFocusNote,
  saveFocusTarget,
} from "./actions";

const n = (v: number) => Math.round(v).toLocaleString("en-MY");
const toNum = (s: string): number | null => {
  const t = s.replace(/,/g, "").trim();
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
};

export function StatusPill({ status }: { status: TargetStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        STATUS_CLASS[status]
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/** "12,345" + "98% · −245" (green ≥100%, amber ≥90%, red below). */
export function ResultCell({ value, s }: { value: number | null; s: StatusResult }) {
  if (value == null) return <span className="text-gray-300">—</span>;
  const pctCls =
    s.pct == null
      ? "text-gray-400"
      : s.pct >= 1
      ? "text-emerald-600"
      : s.pct >= 0.9
      ? "text-amber-600"
      : "text-red-600";
  return (
    <div className="text-right">
      <div className="tabular-nums text-gray-800">
        {n(value)}
        {s.projected && <span className="ml-1 text-[10px] text-gray-400">fcst</span>}
      </div>
      {s.pct != null && (
        <div className={cn("text-[11px] tabular-nums", pctCls)}>
          {Math.round(s.pct * 100)}%
          {s.gap != null && s.gap !== 0 && (
            <span className="text-gray-400">
              {" "}
              · {s.gap > 0 ? "+" : "−"}
              {n(Math.abs(s.gap))}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function ChannelTargetsForm({
  year,
  month,
  online,
  offline,
}: {
  year: number;
  month: number;
  online: number | null;
  offline: number | null;
}) {
  const router = useRouter();
  const [on, setOn] = useState(online == null ? "" : String(online));
  const [off, setOff] = useState(offline == null ? "" : String(offline));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = on !== (online == null ? "" : String(online)) || off !== (offline == null ? "" : String(offline));

  function save() {
    const a = toNum(on);
    const b = toNum(off);
    if (Number.isNaN(a) || Number.isNaN(b) || (a ?? 0) < 0 || (b ?? 0) < 0) {
      setMsg({ ok: false, text: "Targets must be whole numbers of units" });
      return;
    }
    setMsg(null);
    start(async () => {
      const r = await saveChannelTargets(year, month, { ONLINE: a, OFFLINE: b });
      setMsg(r.ok ? { ok: true, text: "Saved" } : { ok: false, text: r.error ?? "Couldn't save" });
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      {(
        [
          ["Online target", on, setOn],
          ["Offline target", off, setOff],
        ] as const
      ).map(([lbl, val, set]) => (
        <label key={lbl} className="flex flex-col gap-1 text-xs text-gray-600">
          {lbl}
          <input
            inputMode="numeric"
            value={val}
            onChange={(e) => set(e.target.value)}
            placeholder="units"
            className="w-36 border border-gray-300 rounded-md px-2 py-1.5 text-sm text-right tabular-nums bg-white"
          />
        </label>
      ))}
      <button
        type="button"
        onClick={save}
        disabled={pending || !dirty}
        className="rounded-md bg-gray-800 text-white px-3 py-1.5 text-sm hover:bg-gray-700 disabled:opacity-40"
      >
        {pending ? "Saving…" : "Save targets"}
      </button>
      {msg && (
        <span className={cn("text-xs", msg.ok ? "text-emerald-600" : "text-red-600")}>{msg.text}</span>
      )}
      <span className="text-[11px] text-gray-400">Leave blank for no target.</span>
    </div>
  );
}

export type FocusRowData = {
  productId: string;
  label: string;
  family: string;
  sku: string;
  online: { target: number | null; value: number | null; s: StatusResult; hint: number | null };
  offline: { target: number | null; value: number | null; s: StatusResult; hint: number | null };
  overall: TargetStatus;
  note: string | null;
};

export function FocusRow({
  year,
  month,
  row,
  canEdit,
}: {
  year: number;
  month: number;
  row: FocusRowData;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [on, setOn] = useState(row.online.target == null ? "" : String(row.online.target));
  const [off, setOff] = useState(row.offline.target == null ? "" : String(row.offline.target));
  const [note, setNote] = useState(row.note ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function saveTargets() {
    const a = toNum(on);
    const b = toNum(off);
    const unchanged = a === row.online.target && b === row.offline.target;
    if (unchanged) return;
    if (Number.isNaN(a) || Number.isNaN(b) || (a ?? 0) < 0 || (b ?? 0) < 0) {
      setErr("Targets must be whole numbers");
      return;
    }
    setErr(null);
    start(async () => {
      const r = await saveFocusTarget(year, month, row.productId, { online: a, offline: b });
      if (!r.ok) setErr(r.error ?? "Couldn't save");
      else router.refresh();
    });
  }
  function saveNote() {
    if ((note.trim() || null) === (row.note?.trim() || null)) return;
    start(async () => {
      const r = await saveFocusNote(year, month, row.productId, note);
      if (!r.ok) setErr(r.error ?? "Couldn't save note");
      else router.refresh();
    });
  }
  function remove() {
    if (!confirm(`Remove ${row.label} from this month's focus products?`)) return;
    start(async () => {
      const r = await removeFocusProduct(year, month, row.productId);
      if (!r.ok) setErr(r.error ?? "Couldn't remove");
      else router.refresh();
    });
  }

  const targetInput = (
    val: string,
    set: (v: string) => void,
    hint: number | null,
    current: number | null
  ) =>
    canEdit ? (
      <input
        inputMode="numeric"
        value={val}
        disabled={pending}
        onChange={(e) => set(e.target.value)}
        onBlur={saveTargets}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        placeholder={hint != null ? `fcst ${n(hint)}` : "—"}
        title={hint != null ? `Forecast for the month: ${n(hint)}` : undefined}
        className="w-24 border border-gray-300 rounded px-1.5 py-1 text-right tabular-nums bg-white placeholder:text-gray-300 disabled:opacity-50"
      />
    ) : (
      <span className="tabular-nums">{current == null ? "—" : n(current)}</span>
    );

  return (
    <tr className={cn("border-b border-gray-100 align-top", row.overall === "missed" && "bg-red-50/30")}>
      <td className="py-2 pl-4 pr-3" title={row.sku}>
        <div className="text-gray-900">{row.label}</div>
        <div className="text-[11px] text-gray-400">{row.family}</div>
        {err && <div className="text-[11px] text-red-600 mt-0.5">{err}</div>}
      </td>
      <td className="py-2 px-2 text-right">
        {targetInput(on, setOn, row.online.hint, row.online.target)}
      </td>
      <td className="py-2 px-3">
        <ResultCell value={row.online.target == null ? null : row.online.value} s={row.online.s} />
      </td>
      <td className="py-2 px-2 text-right border-l border-gray-100">
        {targetInput(off, setOff, row.offline.hint, row.offline.target)}
      </td>
      <td className="py-2 px-3">
        <ResultCell value={row.offline.target == null ? null : row.offline.value} s={row.offline.s} />
      </td>
      <td className="py-2 px-3 border-l border-gray-100">
        <StatusPill status={row.overall} />
      </td>
      <td className="py-2 px-3 min-w-[14rem]">
        {canEdit ? (
          <textarea
            value={note}
            rows={1}
            disabled={pending}
            onChange={(e) => setNote(e.target.value)}
            onBlur={saveNote}
            placeholder={row.overall === "missed" || row.overall === "at_risk" ? "Reason / next action" : "Note"}
            className="w-full border border-gray-200 rounded px-1.5 py-1 text-xs bg-white resize-y placeholder:text-gray-300"
          />
        ) : (
          <span className="text-xs text-gray-600 whitespace-pre-wrap">{row.note || "—"}</span>
        )}
      </td>
      <td className="py-2 pr-4 pl-1 text-right">
        {canEdit && (
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            title="Remove from focus products"
            className="text-gray-300 hover:text-red-600 text-sm disabled:opacity-40"
          >
            ×
          </button>
        )}
      </td>
    </tr>
  );
}

export type FocusOption = {
  id: string;
  label: string;
  hintOnline: number | null;
  hintOffline: number | null;
};

export function AddFocusProduct({
  year,
  month,
  options,
  prevLabel,
}: {
  year: number;
  month: number;
  options: FocusOption[];
  prevLabel: string;
}) {
  const router = useRouter();
  const [pick, setPick] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const chosen = options.find((o) => o.id === pick);

  function add() {
    if (!pick) return;
    setMsg(null);
    start(async () => {
      const r = await saveFocusTarget(year, month, pick, { online: null, offline: null });
      if (!r.ok) setMsg({ ok: false, text: r.error ?? "Couldn't add" });
      else {
        setPick("");
        router.refresh();
      }
    });
  }
  function copy() {
    setMsg(null);
    start(async () => {
      const r = await copyFocusFromPreviousMonth(year, month);
      if (!r.ok) setMsg({ ok: false, text: r.error ?? "Couldn't copy" });
      else {
        setMsg({ ok: true, text: `Copied ${r.copied ?? 0} product${r.copied === 1 ? "" : "s"}` });
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select
        value={pick}
        onChange={(e) => setPick(e.target.value)}
        disabled={pending}
        className="border border-gray-300 rounded-md px-2 py-1.5 bg-white max-w-[22rem]"
      >
        <option value="">Add a focus product…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={add}
        disabled={!pick || pending}
        className="rounded-md bg-gray-800 text-white px-3 py-1.5 hover:bg-gray-700 disabled:opacity-40"
      >
        Add
      </button>
      {chosen && (chosen.hintOnline != null || chosen.hintOffline != null) && (
        <span className="text-xs text-gray-400">
          Forecast: online {chosen.hintOnline == null ? "—" : n(chosen.hintOnline)} · offline{" "}
          {chosen.hintOffline == null ? "—" : n(chosen.hintOffline)}
        </span>
      )}
      <button
        type="button"
        onClick={copy}
        disabled={pending}
        className="ml-auto rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        title={`Add ${prevLabel}'s focus products and their targets to this month`}
      >
        Copy {prevLabel}&rsquo;s focus list
      </button>
      {msg && (
        <span className={cn("text-xs w-full", msg.ok ? "text-emerald-600" : "text-red-600")}>{msg.text}</span>
      )}
    </div>
  );
}
