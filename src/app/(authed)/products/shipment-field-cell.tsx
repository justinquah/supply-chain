"use client";

import { useState, useTransition } from "react";
import { updateUnitsPerShipment } from "./actions";

// Inline numeric editor for products.units_per_shipment (one shipment's loading
// size in main units). Mirrors PackFieldCell, but the value is nullable: leaving
// the field blank clears the loading size (server allows null). A present value
// must be > 0.
export function ShipmentFieldCell({
  productId,
  value,
}: {
  productId: string;
  value: number | null;
}) {
  const [current, setCurrent] = useState<number | null>(value ?? null);
  const [draft, setDraft] = useState(value != null ? String(value) : "");
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function save() {
    const trimmed = draft.trim();
    let num: number | null = null;
    if (trimmed !== "") {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n <= 0) {
        setMsg({ ok: false, text: "Must be > 0" });
        return;
      }
      num = n;
    }
    if (num === current) {
      setMsg(null);
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const res = await updateUnitsPerShipment(productId, num);
      if (res.ok) {
        setCurrent(num);
        setMsg({ ok: true, text: "Saved" });
      } else {
        setMsg({ ok: false, text: res.error ?? "Failed to save" });
      }
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        min={0}
        step="1"
        placeholder="—"
        value={draft}
        disabled={isPending}
        onChange={(e) => {
          setDraft(e.target.value);
          setMsg(null);
        }}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="border border-gray-300 rounded-md px-1.5 py-0.5 text-xs w-20 text-right focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
      />
      {msg && (
        <span
          className={
            "text-[10px] " + (msg.ok ? "text-emerald-600" : "text-red-600")
          }
        >
          {msg.text}
        </span>
      )}
    </div>
  );
}
