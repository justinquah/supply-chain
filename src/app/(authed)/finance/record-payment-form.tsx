"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { recordPayment } from "./actions";

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

type Props = {
  poId: string;
  poNumber: string | null;
  supplierName: string | null;
  /** Whether the current signed-in user is FINANCE (only they can submit). */
  isFinance: boolean;
};

export function RecordPaymentForm({ poId, poNumber, supplierName, isFinance }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!isFinance) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    fd.set("po_id", poId);
    const res = await recordPayment(fd);
    setSaving(false);
    if (res.ok) {
      setMsg("Payment recorded.");
      setOpen(false);
      router.refresh();
    } else {
      setMsg(`Error: ${res.error}`);
    }
  }

  return (
    <div>
      {!open && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setOpen(true);
            setMsg(null);
          }}
        >
          Record payment
        </Button>
      )}

      {open && (
        <form
          onSubmit={handleSubmit}
          className="mt-3 border border-gray-200 rounded-lg p-4 space-y-3 bg-white"
        >
          <p className="text-sm font-medium text-gray-800">
            Record payment — {poNumber || "draft"}{" "}
            {supplierName ? `· ${supplierName}` : ""}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Amount (MYR) *">
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
            <Field label="Date paid *">
              <input name="paid_at" type="date" required className={inputCls} />
            </Field>
            <Field label="Leg">
              <select name="leg" className={inputCls} defaultValue="OTHER">
                <option value="DEPOSIT">Deposit</option>
                <option value="BALANCE">Balance</option>
                <option value="OTHER">Other</option>
              </select>
            </Field>
          </div>

          <Field label="Notes">
            <input name="notes" className={inputCls} placeholder="optional" />
          </Field>

          <label className="block">
            <span className="text-xs text-gray-500 block mb-1">Payment slip (optional)</span>
            <input
              type="file"
              name="payment_slip"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              className="block w-full text-xs text-gray-600 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
            />
          </label>

          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? "Saving…" : "Save payment"}
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
      )}
    </div>
  );
}
