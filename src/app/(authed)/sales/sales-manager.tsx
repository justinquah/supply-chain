"use client";

import { useState, useTransition } from "react";
import { deleteSalesBatches } from "./actions";

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Period = { year: number; month: number; online: number; offline: number };
type Batch = { year: number; month: number; channel: "ONLINE" | "OFFLINE" };

function keyOf(b: Batch) {
  return `${b.year}-${b.month}-${b.channel}`;
}
function fmt(n: number) {
  return Math.round(n).toLocaleString("en-MY");
}

export function SalesManager({ periods }: { periods: Period[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function toggle(b: Batch) {
    const k = keyOf(b);
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  const selected: Batch[] = [];
  for (const p of periods) {
    for (const ch of ["ONLINE", "OFFLINE"] as const) {
      if (sel.has(keyOf({ year: p.year, month: p.month, channel: ch }))) {
        selected.push({ year: p.year, month: p.month, channel: ch });
      }
    }
  }

  function onDelete() {
    if (selected.length === 0) return;
    const label = selected
      .map((b) => `${MONTHS[b.month]} ${b.year} ${b.channel === "ONLINE" ? "Online" : "Offline"}`)
      .join(", ");
    if (!confirm(`Delete sales for: ${label}?\nThis removes those sold-unit records. You can re-upload afterwards.`)) return;
    setMsg(null);
    start(async () => {
      const res = await deleteSalesBatches(selected);
      if (res.ok) {
        setMsg({ ok: true, text: `Deleted ${res.deleted} row${res.deleted === 1 ? "" : "s"}.` });
        setSel(new Set());
      } else {
        setMsg({ ok: false, text: res.error ?? "Delete failed" });
      }
    });
  }

  if (periods.length === 0) {
    return <p className="text-sm text-gray-400 py-2">No sales data uploaded yet.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200">
              <th className="py-2 pr-3 font-medium">Month</th>
              <th className="py-2 px-3 font-medium text-right">Online units</th>
              <th className="py-2 px-2 font-medium text-center">Del</th>
              <th className="py-2 px-3 font-medium text-right">Offline units</th>
              <th className="py-2 px-2 font-medium text-center">Del</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={`${p.year}-${p.month}`} className="border-b border-gray-100">
                <td className="py-2 pr-3 font-medium text-gray-800">
                  {MONTHS[p.month]} {p.year}
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-gray-600">
                  {p.online > 0 ? fmt(p.online) : "—"}
                </td>
                <td className="py-2 px-2 text-center">
                  {p.online > 0 && (
                    <input
                      type="checkbox"
                      checked={sel.has(keyOf({ year: p.year, month: p.month, channel: "ONLINE" }))}
                      onChange={() => toggle({ year: p.year, month: p.month, channel: "ONLINE" })}
                    />
                  )}
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-gray-600">
                  {p.offline > 0 ? fmt(p.offline) : "—"}
                </td>
                <td className="py-2 px-2 text-center">
                  {p.offline > 0 && (
                    <input
                      type="checkbox"
                      checked={sel.has(keyOf({ year: p.year, month: p.month, channel: "OFFLINE" }))}
                      onChange={() => toggle({ year: p.year, month: p.month, channel: "OFFLINE" })}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={onDelete}
          disabled={selected.length === 0 || pending}
          className="rounded-md bg-red-600 text-white text-sm px-3 py-1.5 font-medium disabled:opacity-40 hover:bg-red-700"
        >
          {pending ? "Deleting…" : `Delete selected (${selected.length})`}
        </button>
        {msg && (
          <span className={"text-sm " + (msg.ok ? "text-emerald-700" : "text-red-600")}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
