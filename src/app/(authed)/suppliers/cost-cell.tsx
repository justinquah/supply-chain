"use client";

import { useState, useTransition } from "react";
import { updateCost } from "./actions";

const CURRENCIES = ["MYR", "USD", "CNY", "THB"] as const;

function money(n: number | null | undefined, cur: string | null | undefined) {
  if (n == null) return "—";
  return `${cur || ""} ${Number(n).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`.trim();
}

export function CostCell({
  productId,
  supplierId,
  unitCost,
  costCurrency,
  unitsPerCarton = 1,
}: {
  productId: string;
  supplierId: string;
  unitCost: number;
  costCurrency: string;
  unitsPerCarton?: number;
}) {
  const upc = Number.isFinite(unitsPerCarton) && unitsPerCarton > 0 ? unitsPerCarton : 1;
  const showToggle = upc > 1;

  const [editing, setEditing] = useState(false);
  const [basis, setBasis] = useState<"unit" | "carton">("unit");
  const [cost, setCost] = useState(String(unitCost));
  const [currency, setCurrency] = useState(costCurrency);
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Canonical per-UNIT cost derived from the entered value + current basis.
  const entered = Number(cost);
  const unitEquivalent =
    Number.isFinite(entered) ? (basis === "carton" ? entered / upc : entered) : null;
  const cartonEquivalent = unitEquivalent != null ? unitEquivalent * upc : null;

  function reset() {
    setEditing(false);
    setBasis("unit");
    setCost(String(unitCost));
    setCurrency(costCurrency);
    setNote("");
    setMsg(null);
  }

  // Switching basis re-expresses the value the user is currently looking at so
  // the amount stays visually consistent (e.g. per-unit 2.00 → per-carton 24.00).
  function switchBasis(next: "unit" | "carton") {
    if (next === basis) return;
    const n = Number(cost);
    if (Number.isFinite(n)) {
      const converted = next === "carton" ? n * upc : n / upc;
      setCost(String(Number(converted.toFixed(4))));
    }
    setBasis(next);
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    startTransition(async () => {
      const res = await updateCost(productId, supplierId, Number(cost), currency, note, basis);
      if (res.ok) {
        setEditing(false);
        setBasis("unit");
        setNote("");
      } else {
        setMsg({ ok: false, text: res.error ?? "Failed to update cost" });
      }
    });
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="tabular-nums text-gray-900 hover:underline"
        title="Click to update cost"
      >
        {money(unitCost, costCurrency)}
      </button>
    );
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          step="0.01"
          autoFocus
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          className="border border-gray-300 rounded-md px-1.5 py-0.5 text-xs w-20 text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className="border border-gray-300 rounded-md px-1 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      {showToggle && (
        <div className="flex items-center gap-1 text-[10px]">
          <select
            value={basis}
            onChange={(e) => switchBasis(e.target.value as "unit" | "carton")}
            className="border border-gray-300 rounded-md px-1 py-0.5 text-[10px] focus:outline-none focus:ring-2 focus:ring-blue-400"
            title={`1 carton = ${upc} units`}
          >
            <option value="unit">per unit</option>
            <option value="carton">per carton</option>
          </select>
          {unitEquivalent != null && (
            <span className="text-gray-500">
              = {money(unitEquivalent, currency)}/unit · {money(cartonEquivalent, currency)}/carton
            </span>
          )}
        </div>
      )}
      <input
        type="text"
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="border border-gray-300 rounded-md px-1.5 py-0.5 text-xs w-40 focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="text-xs text-blue-600 hover:underline disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={reset}
          className="text-xs text-gray-500 hover:underline"
        >
          Cancel
        </button>
      </div>
      {msg && <span className="text-xs text-red-600">{msg.text}</span>}
    </form>
  );
}
