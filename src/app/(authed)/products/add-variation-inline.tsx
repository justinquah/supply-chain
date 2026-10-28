"use client";

import { useState } from "react";
import { addProduct } from "./actions";
import { Button } from "@/components/ui/button";

const CURRENCIES = ["MYR", "USD", "CNY", "THB"];

// Compact form to add one more variation to an existing product range.
// Pre-fills product_family from the group; auto-composes `name` as
// "<family> - <variation>" so the new row lands in the right group and reads
// consistently with existing siblings.
export function AddVariationInline({
  family,
  defaultCostCurrency,
}: {
  family: string;
  defaultCostCurrency?: string;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState({
    sku: "",
    variation: "",
    unit_cost: "",
    cost_currency: defaultCostCurrency || "MYR",
    units_per_carton: "1",
    stock_pieces_per_unit: "1",
    launch_date: "",
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function reset() {
    setForm({
      sku: "",
      variation: "",
      unit_cost: "",
      cost_currency: defaultCostCurrency || "MYR",
      units_per_carton: "1",
      stock_pieces_per_unit: "1",
      launch_date: "",
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const variation = form.variation.trim();
    const res = await addProduct({
      sku: form.sku.trim(),
      name: variation ? `${family} - ${variation}` : family,
      product_family: family,
      variation,
      unit_cost: form.unit_cost ? Number(form.unit_cost) : null,
      cost_currency: form.cost_currency,
      units_per_carton: form.units_per_carton ? Number(form.units_per_carton) : 1,
      stock_pieces_per_unit: form.stock_pieces_per_unit
        ? Number(form.stock_pieces_per_unit)
        : 1,
      launch_date: form.launch_date || null,
      is_active: true,
    });
    setSaving(false);
    if (res.ok) {
      setMsg({ ok: true, text: `Added ${form.sku}` });
      reset();
    } else {
      setMsg({ ok: false, text: res.error ?? "Failed to add variation" });
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-brand hover:underline mt-1"
      >
        + Add variation
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="px-4 py-3 border-t border-gray-100 bg-gray-50/40 space-y-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-700">
          Add variation to {family}
        </span>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setMsg(null);
          }}
          className="text-xs text-gray-500 hover:text-gray-800"
        >
          Close
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 text-xs">
        <Field label="SKU *">
          <input
            required
            value={form.sku}
            onChange={(e) => set("sku", e.target.value)}
            className={inp}
            placeholder="e.g. BC-…"
          />
        </Field>
        <Field label="Variation *">
          <input
            required
            value={form.variation}
            onChange={(e) => set("variation", e.target.value)}
            className={inp}
            placeholder="e.g. Vanilla"
          />
        </Field>
        <Field label="Unit cost">
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.unit_cost}
            onChange={(e) => set("unit_cost", e.target.value)}
            className={inp}
          />
        </Field>
        <Field label="Currency">
          <select
            value={form.cost_currency}
            onChange={(e) => set("cost_currency", e.target.value)}
            className={inp}
          >
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Units / carton">
          <input
            type="number"
            step="1"
            min="1"
            value={form.units_per_carton}
            onChange={(e) => set("units_per_carton", e.target.value)}
            className={inp}
          />
        </Field>
        <Field label="Stock pcs / unit">
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.stock_pieces_per_unit}
            onChange={(e) => set("stock_pieces_per_unit", e.target.value)}
            className={inp}
          />
        </Field>
        <Field label="Launch date">
          <input
            type="date"
            value={form.launch_date}
            onChange={(e) => set("launch_date", e.target.value)}
            className={inp}
          />
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Adding…" : "Add variation"}
        </Button>
        {msg && (
          <span
            className={
              "text-xs " + (msg.ok ? "text-emerald-700" : "text-red-600")
            }
          >
            {msg.text}
          </span>
        )}
      </div>
    </form>
  );
}

const inp =
  "w-full border border-gray-300 rounded-md px-2 py-1 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand/40";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-gray-500">{label}</span>
      {children}
    </label>
  );
}
