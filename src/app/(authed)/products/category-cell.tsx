"use client";

import { useState, useTransition } from "react";
import { updateProductCategory } from "./actions";

export type CategoryOption = { id: string; name: string };

// Inline category editor for a product. Mirrors LaunchDateCell / PackFieldCell:
// change the <select> → save via a server action → show Saved/error. The empty
// value maps to null = "Uncategorised".
export function CategoryCell({
  productId,
  categoryId,
  options,
}: {
  productId: string;
  categoryId: string | null;
  options: CategoryOption[];
}) {
  const [value, setValue] = useState(categoryId ?? "");
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    setValue(next);
    setMsg(null);
    startTransition(async () => {
      const res = await updateProductCategory(productId, next || null);
      setMsg(
        res.ok
          ? { ok: true, text: "Saved" }
          : { ok: false, text: res.error ?? "Failed to save" }
      );
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={value}
        disabled={isPending}
        onChange={handleChange}
        className="border border-gray-300 rounded-md px-1.5 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
      >
        <option value="">Uncategorised</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
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
