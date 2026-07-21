"use client";

import { useState } from "react";
import { saveStockLevels } from "./actions";
import { Button } from "@/components/ui/button";

type Row = {
  id: string;
  sku: string;
  label: string;
  current: number;
};

export function StockForm({ rows, canEdit }: { rows: Row[]; canEdit: boolean }) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(rows.map((r) => [r.id, String(r.current)]))
  );
  // Re-sync when the server sends different quantities (e.g. after an upload
  // refreshes the page) so stale inputs can't be saved over a fresh upload.
  const rowsKey = rows.map((r) => `${r.id}:${r.current}`).join("|");
  const [syncedKey, setSyncedKey] = useState(rowsKey);
  if (rowsKey !== syncedKey) {
    setSyncedKey(rowsKey);
    setValues(Object.fromEntries(rows.map((r) => [r.id, String(r.current)])));
  }
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    const entries = rows
      .map((r) => ({
        product_id: r.id,
        quantity: Number(values[r.id]),
        changed: Number(values[r.id]) !== r.current,
      }))
      .filter((e) => e.changed && Number.isFinite(e.quantity));

    if (entries.length === 0) {
      setMsg("No changes to save.");
      setSaving(false);
      return;
    }

    const res = await saveStockLevels(
      entries.map(({ product_id, quantity }) => ({ product_id, quantity }))
    );
    setSaving(false);
    setMsg(
      res.ok
        ? `Saved ${res.saved} stock update${res.saved === 1 ? "" : "s"}.`
        : `Error: ${res.error}`
    );
  }

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save stock levels"}
          </Button>
          {msg && <span className="text-sm text-gray-600">{msg}</span>}
        </div>
      )}
      <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200">
              <th className="py-2 px-4 font-medium">Product</th>
              <th className="py-2 px-4 font-medium text-right">Current</th>
              <th className="py-2 px-4 font-medium text-right w-40">
                New quantity
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-gray-100">
                <td className="py-2 px-4">
                  <div className="font-medium text-gray-900">{r.label}</div>
                  <div className="text-xs text-gray-400">{r.sku}</div>
                </td>
                <td className="py-2 px-4 text-right tabular-nums text-gray-500">
                  {r.current.toLocaleString("en-MY")}
                </td>
                <td className="py-2 px-4 text-right">
                  <input
                    type="number"
                    disabled={!canEdit}
                    value={values[r.id] ?? ""}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [r.id]: e.target.value }))
                    }
                    className="w-32 text-right border border-gray-300 rounded-md px-2 py-1 disabled:bg-gray-50 disabled:text-gray-400"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
