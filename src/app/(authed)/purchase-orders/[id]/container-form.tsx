"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { updateContainerNumber } from "../actions";

const inputCls =
  "border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40";

/**
 * SCM/ADMIN/LOGISTICS edit for the PO's container number. Rendering is gated on
 * the server (detail page); the server action re-checks the role. Free text —
 * some POs share or split containers. Clearing the field removes it.
 */
export function ContainerForm({
  poId,
  current,
}: {
  poId: string;
  current: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const dirty = value.trim() !== (current ?? "");

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await updateContainerNumber(poId, value);
      if (res.ok) {
        setMsg("Container number saved.");
        router.refresh();
      } else {
        setMsg(`Error: ${res.error ?? "Could not save container number"}`);
      }
    } catch (e) {
      setMsg(
        `Error: ${e instanceof Error ? e.message : "Could not save container number"}`
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="text-xs text-gray-500 block mb-1">Container number</span>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. MSKU1234567"
          className={inputCls}
        />
      </label>
      <Button size="sm" onClick={save} disabled={!dirty || saving}>
        {saving ? "Saving…" : "Save"}
      </Button>
      {msg && <span className="text-xs text-gray-500">{msg}</span>}
    </div>
  );
}
