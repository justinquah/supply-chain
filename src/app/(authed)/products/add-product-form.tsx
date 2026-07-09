"use client";

import { useState } from "react";
import { addProduct } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const CURRENCIES = ["MYR", "USD", "CNY", "THB"];

const EMPTY = {
  sku: "",
  name: "",
  product_family: "",
  variation: "",
  unit_cost: "",
  cost_currency: "MYR",
  launch_date: "",
  units_per_carton: "1",
  stock_pieces_per_unit: "1",
  is_active: true,
};

export function AddProductForm() {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function set<K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const res = await addProduct({
      sku: form.sku,
      name: form.name,
      product_family: form.product_family,
      variation: form.variation,
      unit_cost: form.unit_cost ? Number(form.unit_cost) : null,
      cost_currency: form.cost_currency,
      launch_date: form.launch_date || null,
      units_per_carton: form.units_per_carton ? Number(form.units_per_carton) : 1,
      stock_pieces_per_unit: form.stock_pieces_per_unit ? Number(form.stock_pieces_per_unit) : 1,
      is_active: form.is_active,
    });
    setSaving(false);
    if (res.ok) {
      setMsg({ ok: true, text: `Added ${form.sku}` });
      setForm(EMPTY);
    } else {
      setMsg({ ok: false, text: res.error ?? "Failed to add product" });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add product</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600">SKU *</span>
              <input
                required
                value={form.sku}
                onChange={(e) => set("sku", e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1.5 bg-white"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600">Name *</span>
              <input
                required
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1.5 bg-white"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600">Range (product family)</span>
              <input
                value={form.product_family}
                onChange={(e) => set("product_family", e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1.5 bg-white"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600">Variation</span>
              <input
                value={form.variation}
                onChange={(e) => set("variation", e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1.5 bg-white"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600">Unit cost</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.unit_cost}
                onChange={(e) => set("unit_cost", e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1.5 bg-white"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600">Currency</span>
              <select
                value={form.cost_currency}
                onChange={(e) => set("cost_currency", e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1.5 bg-white"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600">Launch date</span>
              <input
                type="date"
                value={form.launch_date}
                onChange={(e) => set("launch_date", e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1.5 bg-white"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600">Units / carton</span>
              <input
                type="number"
                step="1"
                min="1"
                value={form.units_per_carton}
                onChange={(e) => set("units_per_carton", e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1.5 bg-white"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600" title="Pieces the stock file counts per main unit — imports divide by this">
                Stock pcs / unit
              </span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.stock_pieces_per_unit}
                onChange={(e) => set("stock_pieces_per_unit", e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1.5 bg-white"
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => set("is_active", e.target.checked)}
            />
            <span className="text-gray-600">Active</span>
          </label>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving}>
              {saving ? "Adding..." : "Add product"}
            </Button>
            {msg && (
              <span className={"text-sm " + (msg.ok ? "text-emerald-600" : "text-red-600")}>
                {msg.text}
              </span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
