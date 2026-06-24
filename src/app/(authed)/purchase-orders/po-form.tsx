"use client";

import { useState, useRef } from "react";
import { savePurchaseOrder } from "./actions";
import { Button } from "@/components/ui/button";

type Option = { id: string; label: string };

export function PoForm({
  suppliers,
  groups,
}: {
  suppliers: Option[];
  groups: string[];
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    const res = await savePurchaseOrder(fd);
    setSaving(false);
    if (res.ok) {
      setMsg("Draft saved.");
      formRef.current?.reset();
    } else {
      setMsg(`Error: ${res.error}`);
    }
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>+ New PO (draft)</Button>;
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold">New PO — draft</h3>
        <button
          onClick={() => setOpen(false)}
          className="text-sm text-gray-500 hover:text-gray-800"
        >
          Close
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Capture the supplier, product range, and the expected cost / payment plan.
        The signed PO PDF, supplier invoice, BL/K1 and receipt happen at later
        stages and on each PO&rsquo;s detail page.
      </p>
      <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Field label="Supplier *">
            <select name="supplier_id" required className={inputCls} defaultValue="">
              <option value="">— select —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Product range">
            <select name="product_group" className={inputCls} defaultValue="">
              <option value="">— select —</option>
              {groups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
          <Field label="PO number (optional)">
            <input name="po_number" className={inputCls} placeholder="set at approval" />
          </Field>

          <Field label="Expected invoice amount">
            <input
              name="expected_invoice_amount"
              type="number"
              step="0.01"
              className={inputCls}
              placeholder="0.00"
            />
          </Field>
          <Field label="Currency">
            <select name="invoice_currency" className={inputCls} defaultValue="MYR">
              <option>MYR</option>
              <option>USD</option>
              <option>CNY</option>
              <option>THB</option>
            </select>
          </Field>
          <Field label="Deposit %">
            <input
              name="deposit_percent"
              type="number"
              step="0.01"
              min="0"
              max="100"
              className={inputCls}
              placeholder="e.g. 30"
            />
          </Field>

          <Field label="Payment terms">
            <input
              name="payment_terms"
              className={inputCls}
              placeholder="e.g. 30% deposit, 70% before shipment"
            />
          </Field>
          <Field label="Deposit due date">
            <input name="deposit_due_date" type="date" className={inputCls} />
          </Field>
          <Field label="Balance due date">
            <input name="balance_due_date" type="date" className={inputCls} />
          </Field>
        </div>

        <Field label="Notes">
          <input name="notes" className={inputCls} placeholder="optional" />
        </Field>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save draft"}
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
    </div>
  );
}

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
