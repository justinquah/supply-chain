"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CLEARANCE_STATUSES,
  CLEARANCE_LABELS,
  CLEARANCE_COLORS,
} from "@/lib/po-workflow";
import {
  updateEtd,
  updateTargetedEta,
  updateLogisticsEta,
  updateEtaToWarehouse,
  updateActualPortArrival,
  updateClearanceStatus,
  setEtaDelayed,
} from "../actions";

const inputCls =
  "w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40";

type Result = { ok: boolean; error?: string };

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  // DATE columns are plain YYYY-MM-DD — format in UTC to avoid off-by-one.
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-MY", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// A labelled read value with an optional inline date editor shown only when the
// current role may edit it. Saves via the passed server action.
function DateField({
  label,
  value,
  editable,
  onSave,
  hint,
}: {
  label: string;
  value: string | null | undefined;
  editable: boolean;
  onSave: (date: string | null) => Promise<Result>;
  hint?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    const res = await onSave(draft || null);
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
      <span className="text-xs text-gray-500 block mb-1">{label}</span>
      {editing ? (
        <div className="space-y-1.5">
          <input
            type="date"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className={inputCls}
          />
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
                setDraft(value ?? "");
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
          <span className="text-gray-900">{fmtDate(value)}</span>
          {editable && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-brand hover:underline"
            >
              {value ? "Edit" : "Set"}
            </button>
          )}
        </div>
      )}
      {hint && <span className="text-[11px] text-gray-400 block mt-0.5">{hint}</span>}
    </div>
  );
}

export type ShipmentRoleCaps = {
  canEtd: boolean; // SCM/ADMIN (internal ETD control)
  canTargeted: boolean; // SCM/ADMIN
  canSupplierEta: boolean; // shown read-only here; supplier edits via portal
  canLogistics: boolean; // LOGISTICS/SCM/ADMIN
  canWarehouseEta: boolean; // LOGISTICS/SCM/ADMIN
  canClearance: boolean; // LOGISTICS/SCM/ADMIN
  canActual: boolean; // LOGISTICS/SCM/ADMIN
  canDelay: boolean; // LOGISTICS/SCM/ADMIN
};

export type ShipmentData = {
  poId: string;
  etd: string | null;
  targeted_eta: string | null;
  supplier_eta: string | null;
  logistics_eta: string | null;
  current_eta_to_port: string | null;
  actual_eta: string | null;
  eta_to_warehouse: string | null;
  clearance_status: string | null;
  eta_delayed: boolean;
  delay_reason: string | null;
};

export function ShipmentForms({
  data,
  caps,
}: {
  data: ShipmentData;
  caps: ShipmentRoleCaps;
}) {
  const { poId } = data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4 text-sm">
        <DateField
          label="ETD (departure)"
          value={data.etd}
          editable={caps.canEtd}
          onSave={(d) => updateEtd(poId, d)}
        />
        <DateField
          label="Targeted ETA (SCM)"
          value={data.targeted_eta}
          editable={caps.canTargeted}
          onSave={(d) => updateTargetedEta(poId, d)}
        />
        <DateField
          label="Supplier ETA"
          value={data.supplier_eta}
          editable={false}
          onSave={async () => ({ ok: true })}
          hint="Supplier sets this in their portal"
        />
        <DateField
          label="Logistics ETA"
          value={data.logistics_eta}
          editable={caps.canLogistics}
          onSave={(d) => updateLogisticsEta(poId, d)}
        />
        <div>
          <span className="text-xs text-gray-500 block mb-1">
            Current ETA to port
          </span>
          <span className="text-gray-900 font-medium">
            {fmtDate(data.current_eta_to_port)}
          </span>
          <span className="text-[11px] text-gray-400 block mt-0.5">
            Logistics → Supplier → Targeted
          </span>
        </div>
        <DateField
          label="Actual port arrival"
          value={data.actual_eta}
          editable={caps.canActual}
          onSave={(d) => updateActualPortArrival(poId, d)}
          hint="Setting this re-anchors the balance due date"
        />
        <DateField
          label="ETA to warehouse"
          value={data.eta_to_warehouse}
          editable={caps.canWarehouseEta}
          onSave={(d) => updateEtaToWarehouse(poId, d)}
        />
        <ClearanceField
          poId={poId}
          value={data.clearance_status}
          editable={caps.canClearance}
        />
      </div>

      <DelayField
        poId={poId}
        delayed={data.eta_delayed}
        reason={data.delay_reason}
        editable={caps.canDelay}
      />
    </div>
  );
}

function ClearanceField({
  poId,
  value,
  editable,
}: {
  poId: string;
  value: string | null;
  editable: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    const res = await updateClearanceStatus(poId, draft);
    setSaving(false);
    if (res.ok) {
      setEditing(false);
      router.refresh();
    } else {
      setErr(res.error || "Failed");
    }
  }

  const badge = value ? (
    <span
      className={
        "inline-block text-[11px] px-2 py-0.5 rounded-full font-medium " +
        (CLEARANCE_COLORS[value] || "bg-gray-100 text-gray-700")
      }
    >
      {CLEARANCE_LABELS[value] || value}
    </span>
  ) : (
    <span className="text-gray-900">—</span>
  );

  return (
    <div>
      <span className="text-xs text-gray-500 block mb-1">Clearance status</span>
      {editing ? (
        <div className="space-y-1.5">
          <select
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className={inputCls}
          >
            <option value="">— select —</option>
            {CLEARANCE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CLEARANCE_LABELS[s]}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving || !draft}
              className="text-xs px-2 py-1 rounded bg-brand text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(value ?? "");
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
          {badge}
          {editable && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-brand hover:underline"
            >
              {value ? "Change" : "Set"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DelayField({
  poId,
  delayed,
  reason,
  editable,
}: {
  poId: string;
  delayed: boolean;
  reason: string | null;
  editable: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draftDelayed, setDraftDelayed] = useState(delayed);
  const [draftReason, setDraftReason] = useState(reason ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    const res = await setEtaDelayed(poId, draftDelayed, draftReason || null);
    setSaving(false);
    if (res.ok) {
      setEditing(false);
      router.refresh();
    } else {
      setErr(res.error || "Failed");
    }
  }

  return (
    <div className="border-t border-gray-100 pt-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-gray-500">Delay</span>
        {delayed ? (
          <span className="inline-block text-[11px] px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700">
            Delayed
          </span>
        ) : (
          <span className="inline-block text-[11px] px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700">
            On schedule
          </span>
        )}
        {delayed && reason && (
          <span className="text-sm text-gray-700">{reason}</span>
        )}
        {editable && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-brand hover:underline"
          >
            Update
          </button>
        )}
      </div>
      {editing && (
        <div className="mt-3 space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draftDelayed}
              onChange={(e) => setDraftDelayed(e.target.checked)}
            />
            Flag this shipment as delayed
          </label>
          {draftDelayed && (
            <input
              type="text"
              value={draftReason}
              onChange={(e) => setDraftReason(e.target.value)}
              className={inputCls}
              placeholder="Reason for delay"
            />
          )}
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
                setDraftDelayed(delayed);
                setDraftReason(reason ?? "");
                setErr(null);
              }}
              className="text-xs text-gray-500 hover:text-gray-800"
            >
              Cancel
            </button>
            {err && <span className="text-xs text-red-600">{err}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
