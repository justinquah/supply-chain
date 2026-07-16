"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  addFinancingObligation,
  deleteFinancingObligation,
} from "./actions";
import type { BankCreditLimitRow } from "./bank-facilities";
import { isSettled } from "@/lib/financing";

const inputCls =
  "w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500 block mb-1">{label}</span>
      {children}
    </label>
  );
}

export type FinancingObligationRow = {
  id: string;
  kind: "BA" | "INVOICE_FINANCING";
  reference: string | null;
  bank: string | null;
  amount: number;
  currency: string;
  due_date: string;
  notes: string | null;
};


function money(n: number, cur: string): string {
  const prefix = cur && cur !== "MYR" ? `${cur} ` : "RM ";
  return (
    prefix +
    Number(n).toLocaleString("en-MY", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function kindLabel(kind: "BA" | "INVOICE_FINANCING"): string {
  return kind === "BA" ? "Banker's Acceptance" : "Invoice Financing";
}

type Props = {
  obligations: FinancingObligationRow[];
  /** Whether the current user can add / delete. */
  canManage: boolean;
  /** Today as "YYYY-MM-DD" in Asia/KL — computed server-side, drives paid state. */
  todayKl: string;
  /** bank_credit_limits rows — the allowed values for the Add form's bank select. */
  banks: BankCreditLimitRow[];
};

export function FinancingObligations({
  obligations,
  canManage,
  todayKl,
  banks,
}: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Outstanding = not yet due. Settled obligations no longer owe anything.
  const outstandingTotal = obligations
    .filter((o) => !isSettled(o.due_date, todayKl))
    .reduce((s, o) => s + Number(o.amount), 0);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, id: string) {
    setBusyId(id);
    setMsg(null);
    const res = await fn();
    setBusyId(null);
    if (res.ok) {
      router.refresh();
    } else {
      setMsg(`Error: ${res.error}`);
    }
  }

  return (
    <div className="space-y-4">
      {/* Outstanding total — everything not yet due */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-600">Outstanding financing total:</span>
        <span className="font-semibold text-indigo-700 tabular-nums">
          {money(outstandingTotal, "MYR")}
        </span>
        <span className="text-xs text-gray-400">
          BA / IF settle automatically on their due date.
        </span>
      </div>

      {/* List */}
      {obligations.length === 0 ? (
        <p className="text-sm text-gray-500">No financing obligations recorded.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-2 pl-1 pr-3 font-medium">Due date</th>
                <th className="py-2 px-3 font-medium">Kind</th>
                <th className="py-2 px-3 font-medium">Reference</th>
                <th className="py-2 px-3 font-medium">Bank</th>
                <th className="py-2 px-3 font-medium text-right">Amount</th>
                <th className="py-2 px-3 font-medium">Status</th>
                {canManage && <th className="py-2 px-3 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {obligations.map((o) => {
                const busy = busyId === o.id;
                const settled = isSettled(o.due_date, todayKl);
                return (
                  <tr
                    key={o.id}
                    className="border-b border-gray-100 hover:bg-gray-50 align-top"
                  >
                    <td className="py-2 pl-1 pr-3 text-gray-700 whitespace-nowrap">
                      {fmtDate(o.due_date)}
                    </td>
                    <td className="py-2 px-3">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-medium">
                        {kindLabel(o.kind)}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-medium text-gray-800">
                      {o.reference || "—"}
                      {o.notes && (
                        <span className="block text-xs text-gray-400 font-normal">
                          {o.notes}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-gray-600">{o.bank || "—"}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-800">
                      {money(Number(o.amount), o.currency)}
                    </td>
                    <td className="py-2 px-3">
                      {/* Derived from due_date — never manually set. */}
                      <span
                        className={
                          "text-xs px-2 py-0.5 rounded-full font-medium " +
                          (settled
                            ? "bg-gray-100 text-gray-500"
                            : "bg-amber-100 text-amber-700")
                        }
                      >
                        {settled ? "Paid" : "Outstanding"}
                      </span>
                    </td>
                    {canManage && (
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if (
                                confirm(
                                  "Delete this financing obligation? This cannot be undone."
                                )
                              ) {
                                run(() => deleteFinancingObligation(o.id), o.id);
                              }
                            }}
                            className="text-xs text-red-600 hover:underline disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {msg && (
        <p className="text-sm text-red-600">{msg}</p>
      )}

      {canManage && <AddFinancingForm banks={banks} />}
    </div>
  );
}

function AddFinancingForm({ banks }: { banks: BankCreditLimitRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    const res = await addFinancingObligation(fd);
    setSaving(false);
    if (res.ok) {
      setMsg("Financing obligation added.");
      setOpen(false);
      router.refresh();
    } else {
      setMsg(`Error: ${res.error}`);
    }
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setOpen(true);
            setMsg(null);
          }}
        >
          Add financing obligation
        </Button>
        {msg && (
          <span
            className={
              "text-sm " +
              (msg.startsWith("Error") ? "text-red-600" : "text-emerald-700")
            }
          >
            {msg}
          </span>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border border-gray-200 rounded-lg p-4 space-y-3 bg-white"
    >
      <p className="text-sm font-medium text-gray-800">
        Add financing obligation (BA / Invoice Financing)
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Kind *">
          <select name="kind" className={inputCls} defaultValue="INVOICE_FINANCING">
            <option value="INVOICE_FINANCING">Invoice Financing</option>
            <option value="BA">Banker&apos;s Acceptance</option>
          </select>
        </Field>
        <Field label="Reference">
          <input name="reference" className={inputCls} placeholder="e.g. IF010" />
        </Field>
        {/* Bank must match a bank_credit_limits row exactly, otherwise the
            facility utilisation card cannot attribute this obligation. */}
        <Field label="Bank">
          <select name="bank" className={inputCls} defaultValue="">
            <option value="">—</option>
            {banks.map((b) => (
              <option key={b.bank} value={b.bank}>
                {b.short_name || b.bank}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount *">
          <input
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            className={inputCls}
            placeholder="0.00"
          />
        </Field>
        <Field label="Currency">
          <select name="currency" className={inputCls} defaultValue="MYR">
            <option value="MYR">MYR</option>
            <option value="USD">USD</option>
          </select>
        </Field>
        <Field label="Due date *">
          <input name="due_date" type="date" required className={inputCls} />
        </Field>
      </div>
      <Field label="Notes">
        <input name="notes" className={inputCls} placeholder="optional" />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false);
            setMsg(null);
          }}
        >
          Cancel
        </Button>
        {msg && (
          <span
            className={
              "text-sm " +
              (msg.startsWith("Error") ? "text-red-600" : "text-emerald-700")
            }
          >
            {msg}
          </span>
        )}
      </div>
    </form>
  );
}
