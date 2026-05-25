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
      setMsg(`Saved. ${res.uploaded ?? 0} file(s) uploaded.`);
      formRef.current?.reset();
    } else {
      setMsg(`Error: ${res.error}`);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>+ New PO / Invoice</Button>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">New PO / Invoice entry</h3>
        <button
          onClick={() => setOpen(false)}
          className="text-sm text-gray-500 hover:text-gray-800"
        >
          Close
        </button>
      </div>
      <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Field label="PO number *">
            <input name="po_number" required className={inputCls} placeholder="PO-2026-001" />
          </Field>
          <Field label="Invoice number">
            <input name="invoice_number" className={inputCls} placeholder="INV-..." />
          </Field>
          <Field label="Supplier">
            <select name="supplier_id" className={inputCls} defaultValue="">
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
          <Field label="Invoice amount">
            <input
              name="invoice_amount"
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
        </div>

        <div>
          <div className="text-sm font-medium text-gray-700 mb-2">
            Documents (PDF / image)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <FileField label="PO" name="file_po" />
            <FileField label="Invoice" name="file_invoice" />
            <FileField label="Bill of Lading" name="file_bl" />
            <FileField label="Packing List" name="file_pl" />
            <FileField label="K1" name="file_k1" />
          </div>
        </div>

        <Field label="Notes">
          <input name="notes" className={inputCls} placeholder="optional" />
        </Field>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save entry"}
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

function FileField({ label, name }: { label: string; name: string }) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500 block mb-1">{label}</span>
      <input
        type="file"
        name={name}
        accept=".pdf,.png,.jpg,.jpeg,.webp"
        className="block w-full text-xs text-gray-600 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
      />
    </label>
  );
}
