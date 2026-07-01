"use client";

import { useState, useTransition } from "react";
import { updateLaunchDate } from "./actions";

export function LaunchDateCell({
  productId,
  launchDate,
}: {
  productId: string;
  launchDate: string | null;
}) {
  const [value, setValue] = useState(launchDate ?? "");
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setValue(next);
    setMsg(null);
    startTransition(async () => {
      const res = await updateLaunchDate(productId, next || null);
      setMsg(
        res.ok
          ? { ok: true, text: "Saved" }
          : { ok: false, text: res.error ?? "Failed to save" }
      );
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="date"
        value={value}
        disabled={isPending}
        onChange={handleChange}
        className="border border-gray-300 rounded-md px-1.5 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
      />
      {!value && !isPending && (
        <span className="text-[10px] text-gray-400">not set</span>
      )}
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
