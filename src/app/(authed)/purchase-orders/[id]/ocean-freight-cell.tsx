"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateOceanFreight } from "../actions";

const inputCls =
  "w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40";

const CURRENCIES = ["USD", "MYR", "CNY", "THB"] as const;

function money(n: number | null | undefined, cur: string | null | undefined) {
  if (n == null) return "—";
  return `${cur || "USD"} ${Number(n).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// Inline editor for the PO's ocean freight add-on cost (visible only when the
// current role may edit it; read-only display otherwise). Mirrors the ETA/cost
// inline editors — a cost input + currency <select> defaulting to USD.
export function OceanFreightCell({
  poId,
  cost,
  currency,
  editable,
}: {
  poId: string;
  cost: number | null;
  currency: string | null;
  editable: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draftCost, setDraftCost] = useState(cost != null ? String(cost) : "");
  const [draftCur, setDraftCur] = useState(currency || "USD");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    const trimmed = draftCost.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed != null && (!Number.isFinite(parsed) || parsed < 0)) {
      setSaving(false);
      setErr("Cost must be a number ≥ 0");
      return;
    }
    const res = await updateOceanFreight(poId, parsed, parsed == null ? null : draftCur);
    setSaving(false);
    if (res.ok) {
      setEditing(false);
      router.refresh();
    } else {
      setErr(res.error || "Failed");
    }
  }

  return (
    <div>
      <span className="text-xs text-gray-500 block mb-1">Ocean freight</span>
      {editing ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.01"
              min="0"
              value={draftCost}
              onChange={(e) => setDraftCost(e.target.value)}
              placeholder="Cost (blank = clear)"
              className={inputCls}
            />
            <select
              value={draftCur}
              onChange={(e) => setDraftCur(e.target.value)}
              className="border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="text-xs px-2 py-1 rounded bg-brand text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraftCost(cost != null ? String(cost) : "");
                setDraftCur(currency || "USD");
                setErr(null);
              }}
              className="text-xs text-gray-500 hover:text-gray-800"
            >
              Cancel
            </button>
            {err && <span className="text-xs text-red-600">{err}</span>}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-gray-900">{money(cost, currency)}</span>
          {editable && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-brand hover:underline"
            >
              {cost != null ? "Edit" : "Set"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
