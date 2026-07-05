"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateSupplierDates } from "./actions";

const inputCls =
  "w-full border border-gray-300 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-brand/40";

// Inline editor for a supplier's own ETD + ETA-to-port (supplier_eta) on one PO.
// Writes go through updateSupplierDates, which enforces PO ownership and the
// two-column whitelist server-side.
export function SupplierDateEditor({
  poId,
  etd,
  supplierEta,
}: {
  poId: string;
  etd: string | null;
  supplierEta: string | null;
}) {
  const router = useRouter();
  const [draftEtd, setDraftEtd] = useState(etd ?? "");
  const [draftEta, setDraftEta] = useState(supplierEta ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMsg(null);
    const res = await updateSupplierDates(poId, draftEtd || null, draftEta || null);
    setSaving(false);
    if (res.ok) {
      setMsg("Saved");
      router.refresh();
    } else {
      setMsg(res.error || "Failed");
    }
  }

  return (
    <div className="flex flex-col gap-1.5 min-w-[9rem]">
      <label className="block">
        <span className="text-[10px] text-gray-400 block">ETD</span>
        <input
          type="date"
          value={draftEtd}
          onChange={(e) => setDraftEtd(e.target.value)}
          className={inputCls}
        />
      </label>
      <label className="block">
        <span className="text-[10px] text-gray-400 block">My ETA to port</span>
        <input
          type="date"
          value={draftEta}
          onChange={(e) => setDraftEta(e.target.value)}
          className={inputCls}
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="text-[11px] px-2 py-0.5 rounded bg-brand text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {msg && (
          <span
            className={
              "text-[11px] " +
              (msg === "Saved" ? "text-emerald-700" : "text-red-600")
            }
          >
            {msg}
          </span>
        )}
      </div>
    </div>
  );
}
