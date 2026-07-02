"use client";

import { useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  createPermit,
  updatePermit,
  deletePermit,
  getPermitDocUrl,
} from "./actions";
import {
  PERMIT_TYPES,
  PERMIT_TYPE_LABELS,
  PERMIT_STATUSES,
  PERMIT_STATUS_LABELS,
} from "./constants";
import { classifyExpiry, type ExpiryState } from "./expiry";

export type Permit = {
  id: string;
  permit_type: string;
  name: string | null;
  reference_no: string | null;
  holder: string | null;
  issued_date: string | null;
  expiry_date: string | null;
  status: string;
  doc_path: string | null;
  notes: string | null;
};

const inputCls =
  "border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";

function formatDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00Z");
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

const EXPIRY_BADGE: Record<ExpiryState, string> = {
  none: "bg-gray-100 text-gray-500 border border-gray-200",
  expired: "bg-red-100 text-red-700 border border-red-200",
  soon: "bg-amber-100 text-amber-700 border border-amber-200",
  valid: "bg-emerald-100 text-emerald-700 border border-emerald-200",
};

function ExpiryBadge({ expiry, today }: { expiry: string | null; today: string }) {
  const info = classifyExpiry(expiry, today);
  return (
    <span
      className={cn(
        "inline-block text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap",
        EXPIRY_BADGE[info.state]
      )}
    >
      {info.label}
    </span>
  );
}

function PermitFields({ permit }: { permit?: Permit }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <div className="flex flex-col">
        <label className="text-[10px] text-gray-500 mb-1">Type</label>
        <select
          name="permit_type"
          defaultValue={permit?.permit_type ?? "OTHER"}
          className={inputCls}
        >
          {PERMIT_TYPES.map((t) => (
            <option key={t} value={t}>
              {PERMIT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] text-gray-500 mb-1">Name / description</label>
        <input name="name" defaultValue={permit?.name ?? ""} className={inputCls} />
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] text-gray-500 mb-1">Reference no.</label>
        <input
          name="reference_no"
          defaultValue={permit?.reference_no ?? ""}
          className={inputCls}
        />
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] text-gray-500 mb-1">Holder</label>
        <input
          name="holder"
          defaultValue={permit?.holder ?? ""}
          className={inputCls}
        />
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] text-gray-500 mb-1">Issued date</label>
        <input
          type="date"
          name="issued_date"
          defaultValue={permit?.issued_date ?? ""}
          className={inputCls}
        />
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] text-gray-500 mb-1">Expiry date</label>
        <input
          type="date"
          name="expiry_date"
          defaultValue={permit?.expiry_date ?? ""}
          className={inputCls}
        />
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] text-gray-500 mb-1">Status</label>
        <select
          name="status"
          defaultValue={permit?.status ?? "ACTIVE"}
          className={inputCls}
        >
          {PERMIT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PERMIT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col sm:col-span-2">
        <label className="text-[10px] text-gray-500 mb-1">
          Document {permit?.doc_path ? "(replaces existing)" : ""}
        </label>
        <input type="file" name="doc" className="text-sm" />
      </div>
      <div className="flex flex-col sm:col-span-2 lg:col-span-3">
        <label className="text-[10px] text-gray-500 mb-1">Notes</label>
        <textarea
          name="notes"
          rows={2}
          defaultValue={permit?.notes ?? ""}
          className={inputCls}
        />
      </div>
    </div>
  );
}

function AddForm() {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    startTransition(async () => {
      const res = await createPermit(fd);
      if (res.ok) {
        setMsg({ ok: true, text: "Permit added" });
        form.reset();
        setOpen(false);
      } else {
        setMsg({ ok: false, text: res.error ?? "Failed to add" });
      }
    });
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={() => setOpen(true)}>
          + Add permit
        </Button>
        {msg && (
          <span className={cn("text-xs", msg.ok ? "text-emerald-600" : "text-red-600")}>
            {msg.text}
          </span>
        )}
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="pt-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            New permit / licence
          </div>
          <PermitFields />
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Saving…" : "Save permit"}
            </Button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-gray-500 hover:underline"
            >
              Cancel
            </button>
            {msg && (
              <span
                className={cn("text-xs", msg.ok ? "text-emerald-600" : "text-red-600")}
              >
                {msg.text}
              </span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function DocLink({ path }: { path: string }) {
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function handleView() {
    setErr(null);
    startTransition(async () => {
      const res = await getPermitDocUrl(path);
      if (res.ok && res.url) {
        window.open(res.url, "_blank", "noopener,noreferrer");
      } else {
        setErr(res.error ?? "Failed to open");
      }
    });
  }

  return (
    <span className="whitespace-nowrap">
      <button
        onClick={handleView}
        disabled={isPending}
        className="text-xs text-blue-600 hover:underline disabled:opacity-50"
      >
        {isPending ? "Opening…" : "View"}
      </button>
      {err && <span className="text-xs text-red-600 ml-1">{err}</span>}
    </span>
  );
}

function PermitRow({ permit, today }: { permit: Permit; today: string }) {
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const info = classifyExpiry(permit.expiry_date, today);
  const rowAccent =
    info.state === "expired"
      ? "border-l-4 border-l-red-400 bg-red-50/40"
      : info.state === "soon"
        ? "border-l-4 border-l-amber-400 bg-amber-50/40"
        : "border-l-4 border-l-transparent";

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updatePermit(permit.id, fd);
      if (res.ok) {
        setEditing(false);
      } else {
        setMsg({ ok: false, text: res.error ?? "Failed to save" });
      }
    });
  }

  function handleDelete() {
    const label = permit.name || PERMIT_TYPE_LABELS[permit.permit_type] || "this permit";
    if (!confirm(`Delete "${label}"?`)) return;
    startTransition(async () => {
      await deletePermit(permit.id);
    });
  }

  if (editing) {
    return (
      <tr className="border-b border-gray-100 bg-gray-50/60">
        <td colSpan={9} className="p-3">
          <form onSubmit={handleSave} className="space-y-3">
            <PermitFields permit={permit} />
            <div className="flex items-center gap-3">
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? "Saving…" : "Save"}
              </Button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="text-xs text-gray-500 hover:underline"
              >
                Cancel
              </button>
              {msg && (
                <span
                  className={cn(
                    "text-xs",
                    msg.ok ? "text-emerald-600" : "text-red-600"
                  )}
                >
                  {msg.text}
                </span>
              )}
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr className={cn("border-b border-gray-50 last:border-0 align-top", rowAccent)}>
      <td className="py-2 pl-3 pr-2 text-gray-700 whitespace-nowrap">
        {PERMIT_TYPE_LABELS[permit.permit_type] ?? permit.permit_type}
      </td>
      <td className="py-2 px-2 text-gray-900">{permit.name || "—"}</td>
      <td className="py-2 px-2 text-gray-600">{permit.reference_no || "—"}</td>
      <td className="py-2 px-2 text-gray-600">{permit.holder || "—"}</td>
      <td className="py-2 px-2 text-gray-600 whitespace-nowrap">
        {formatDate(permit.issued_date)}
      </td>
      <td className="py-2 px-2 text-gray-600 whitespace-nowrap">
        <div>{formatDate(permit.expiry_date)}</div>
        <div className="mt-1">
          <ExpiryBadge expiry={permit.expiry_date} today={today} />
        </div>
      </td>
      <td className="py-2 px-2 text-gray-600 whitespace-nowrap">
        {PERMIT_STATUS_LABELS[permit.status] ?? permit.status}
      </td>
      <td className="py-2 px-2">
        {permit.doc_path ? (
          <DocLink path={permit.doc_path} />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-gray-500 hover:underline"
          >
            + Attach
          </button>
        )}
      </td>
      <td className="py-2 pr-3 pl-2 text-right whitespace-nowrap">
        <button
          onClick={() => setEditing(true)}
          disabled={isPending}
          className="text-xs text-blue-600 hover:underline disabled:opacity-50 mr-3"
        >
          Edit
        </button>
        <button
          onClick={handleDelete}
          disabled={isPending}
          className="text-xs text-red-600 hover:underline disabled:opacity-50"
        >
          Delete
        </button>
      </td>
    </tr>
  );
}

export function PermitsManager({
  permits,
  today,
}: {
  permits: Permit[];
  today: string;
}) {
  return (
    <div className="space-y-4">
      <AddForm />

      {permits.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-gray-400">
            No permits recorded yet. Add the first permit above.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100 bg-gray-50/60">
                  <th className="py-2 pl-3 pr-2 font-medium">Type</th>
                  <th className="py-2 px-2 font-medium">Name</th>
                  <th className="py-2 px-2 font-medium">Reference</th>
                  <th className="py-2 px-2 font-medium">Holder</th>
                  <th className="py-2 px-2 font-medium">Issued</th>
                  <th className="py-2 px-2 font-medium">Expiry</th>
                  <th className="py-2 px-2 font-medium">Status</th>
                  <th className="py-2 px-2 font-medium">Document</th>
                  <th className="py-2 pr-3 pl-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {permits.map((p) => (
                  <PermitRow key={p.id} permit={p} today={today} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
