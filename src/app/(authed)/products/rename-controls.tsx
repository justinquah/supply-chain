"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { renameProduct, renameRange } from "./actions";

// Shared inline "click ✎ → edit → Enter/Save" control.
function InlineRename({
  value,
  onSave,
  textClass,
  inputClass,
}: {
  value: string;
  onSave: (next: string) => Promise<{ ok: boolean; error?: string }>;
  textClass: string;
  inputClass: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function save() {
    const next = draft.trim();
    if (!next || next === value) {
      setEditing(false);
      setDraft(value);
      return;
    }
    setErr(null);
    startTransition(async () => {
      const res = await onSave(next);
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else {
        setErr(res.error ?? "Couldn't save");
      }
    });
  }

  if (!editing) {
    return (
      <span className="group inline-flex items-center gap-1.5">
        <span className={textClass}>{value}</span>
        <button
          type="button"
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
          title="Rename"
          className="text-gray-300 hover:text-brand text-xs opacity-60 group-hover:opacity-100"
        >
          ✎
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <input
        autoFocus
        value={draft}
        disabled={isPending}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setEditing(false);
            setDraft(value);
            setErr(null);
          }
        }}
        className={
          "border border-gray-300 rounded-md px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-brand/40 disabled:opacity-50 " +
          inputClass
        }
      />
      <button
        type="button"
        onClick={save}
        disabled={isPending}
        className="rounded bg-gray-800 text-white px-1.5 py-0.5 text-[11px] hover:bg-gray-700 disabled:opacity-50"
      >
        {isPending ? "…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => {
          setEditing(false);
          setDraft(value);
          setErr(null);
        }}
        disabled={isPending}
        className="text-[11px] text-gray-500 hover:text-gray-800"
      >
        Cancel
      </button>
      {err && <span className="w-full text-[11px] text-red-600">{err}</span>}
    </span>
  );
}

export function ProductNameCell({ productId, label }: { productId: string; label: string }) {
  return (
    <InlineRename
      value={label}
      onSave={(next) => renameProduct(productId, next)}
      textClass="text-gray-900"
      inputClass="text-sm w-56"
    />
  );
}

export function RangeName({ name }: { name: string }) {
  return (
    <InlineRename
      value={name}
      onSave={(next) => renameRange(name, next)}
      textClass="font-semibold text-gray-900"
      inputClass="text-sm font-semibold w-64"
    />
  );
}
