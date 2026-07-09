"use client";

import { useState, useRef } from "react";
import { savePurchaseOrder } from "./actions";
import { Button } from "@/components/ui/button";

type Option = { id: string; label: string };
type ProductOption = Option & { unitsPerCarton?: number };

type ProductLine = {
  key: number;
  productId: string;
  quantity: string;
  unit: "units" | "cartons";
  eta: string;
};

let lineKeySeq = 0;
function newLine(): ProductLine {
  return { key: ++lineKeySeq, productId: "", quantity: "", unit: "units", eta: "" };
}

// Repeatable product + quantity (+ unit basis + optional per-line ETA) rows.
// Serialized as parallel line_product_id[] / line_quantity[] / line_unit[] /
// line_eta[] fields (parsed by parseProductLines in actions.ts). When a line is
// ordered in "cartons" the server multiplies by the product's units_per_carton
// so the stored incoming_stock quantity is always in main units. Any products
// from any range may be added — a single PO can carry lines across multiple ranges.
function ProductLines({ products }: { products: ProductOption[] }) {
  const [lines, setLines] = useState<ProductLine[]>([newLine(), newLine()]);

  function update(key: number, patch: Partial<ProductLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function remove(key: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }
  function add() {
    setLines((prev) => [...prev, newLine()]);
  }

  return (
    <div className="space-y-2">
      <span className="text-xs text-gray-500 block">
        Product lines (product + quantity being ordered — optional; drives the
        dashboard&rsquo;s Incoming / in-transit)
      </span>
      <div className="space-y-2">
        {lines.map((line) => (
          <div key={line.key} className="flex items-center gap-2">
            <select
              name="line_product_id"
              value={line.productId}
              onChange={(e) => update(line.key, { productId: e.target.value })}
              className={inputCls}
            >
              <option value="">— select product —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <input
              name="line_quantity"
              type="number"
              min="1"
              value={line.quantity}
              onChange={(e) => update(line.key, { quantity: e.target.value })}
              className={inputCls + " w-24 shrink-0"}
              placeholder="qty"
            />
            <select
              name="line_unit"
              value={line.unit}
              onChange={(e) =>
                update(line.key, { unit: e.target.value as "units" | "cartons" })
              }
              className={inputCls + " w-28 shrink-0"}
              title="Cartons are converted to units on save (× units/carton)"
            >
              <option value="units">units</option>
              <option value="cartons">cartons</option>
            </select>
            <input
              name="line_eta"
              type="date"
              value={line.eta}
              onChange={(e) => update(line.key, { eta: e.target.value })}
              className={inputCls + " w-40 shrink-0"}
              title="defaults to PO ETA"
              placeholder="defaults to PO ETA"
            />
            <button
              type="button"
              onClick={() => remove(line.key)}
              disabled={lines.length === 1}
              className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-30 disabled:hover:text-gray-400 shrink-0"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={add} className="text-xs text-brand hover:underline">
        + Add line
      </button>
    </div>
  );
}

export function PoForm({
  suppliers,
  groups,
  products,
}: {
  suppliers: Option[];
  groups: string[];
  products: ProductOption[];
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

        <ProductLines products={products} />

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
