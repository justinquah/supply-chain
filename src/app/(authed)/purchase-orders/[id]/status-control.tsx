"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PO_WORKFLOW_STATES, PO_WORKFLOW_LABELS } from "@/lib/po-workflow";
import { updatePoStatus } from "../actions";

const inputCls =
  "border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40";

/**
 * SCM/ADMIN-only manual status override. Any of the six workflow statuses may be
 * selected, forward OR backward, so a mis-clicked hand-off can be corrected.
 * Every save is audit-logged server-side (see updatePoStatus).
 *
 * Rendering is gated on the server (detail page) — this component adds no access
 * of its own; the server action re-checks the role.
 */
export function StatusControl({
  poId,
  current,
}: {
  poId: string;
  current: string;
}) {
  const router = useRouter();
  // Statuses outside the six workflow labels (legacy enum values) are not
  // selectable, so fall back to DRAFT rather than rendering a blank select.
  const known = (PO_WORKFLOW_STATES as readonly string[]).includes(current);
  const [value, setValue] = useState(known ? current : "DRAFT");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const dirty = value !== current;

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await updatePoStatus(poId, value);
      if (res.ok) {
        setMsg("Status updated.");
        router.refresh();
      } else {
        setMsg(`Error: ${res.error ?? "Could not update status"}`);
      }
    } catch (e) {
      setMsg(`Error: ${e instanceof Error ? e.message : "Could not update status"}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="text-xs text-gray-500 block mb-1">Set status</span>
        <select
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setMsg(null);
          }}
          className={inputCls}
        >
          {PO_WORKFLOW_STATES.map((s) => (
            <option key={s} value={s}>
              {PO_WORKFLOW_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <Button type="button" onClick={save} disabled={saving || !dirty}>
        {saving ? "Saving…" : "Save status"}
      </Button>
      {!known && (
        <span className="text-xs text-amber-700">
          Current status “{current}” is a legacy value — saving will move this PO
          onto the current workflow.
        </span>
      )}
      {msg && (
        <span
          className={
            "text-sm " + (msg.startsWith("Error") ? "text-red-600" : "text-emerald-700")
          }
        >
          {msg}
        </span>
      )}
    </div>
  );
}
