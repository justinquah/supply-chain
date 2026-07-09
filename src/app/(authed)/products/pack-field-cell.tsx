"use client";

import { useState, useTransition } from "react";
import { updateUnitsPerCarton, updateStockPiecesPerUnit } from "./actions";

type Field = "units_per_carton" | "stock_pieces_per_unit";

// Inline numeric editor for the two per-product pack fields. Mirrors
// LaunchDateCell: type a value → save via a server action → show Saved/error.
// `field` selects which action + validation applies.
export function PackFieldCell({
  productId,
  field,
  value,
}: {
  productId: string;
  field: Field;
  value: number | null;
}) {
  const [current, setCurrent] = useState(value ?? 1);
  const [draft, setDraft] = useState(String(value ?? 1));
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // stock_pieces_per_unit may be fractional; units_per_carton is a whole number.
  const step = field === "units_per_carton" ? "1" : "0.01";

  function save() {
    const num = Number(draft);
    if (!Number.isFinite(num) || num <= 0) {
      setMsg({ ok: false, text: "Must be > 0" });
      return;
    }
    if (num === current) {
      setMsg(null);
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const res =
        field === "units_per_carton"
          ? await updateUnitsPerCarton(productId, num)
          : await updateStockPiecesPerUnit(productId, num);
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
        step={step}
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
        className="border border-gray-300 rounded-md px-1.5 py-0.5 text-xs w-16 text-right focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
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
