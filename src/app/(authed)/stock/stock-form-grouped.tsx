"use client";

import { Fragment, useState } from "react";
import { saveStockLevels } from "./actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type StockProductRow = {
  id: string;
  sku: string;
  name: string;
  product_family: string | null;
  variation: string | null;
  current: number;
  /** ISO timestamp string from stock_snapshots.recorded_at, or null */
  recorded_at: string | null;
};

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtShort(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth() + 1]}`;
}

type Group = {
  family: string;
  rows: StockProductRow[];
};

export function StockFormGrouped({
  rows,
  canEdit,
}: {
  rows: StockProductRow[];
  canEdit: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(rows.map((r) => [r.id, String(r.current)]))
  );
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Group by product_family
  const map = new Map<string, Group>();
  for (const p of rows) {
    const fam = p.product_family || p.name;
    const g = map.get(fam) ?? { family: fam, rows: [] };
    g.rows.push(p);
    map.set(fam, g);
  }
  const groups = [...map.values()].sort((a, b) => a.family.localeCompare(b.family));

  function isOpen(fam: string, multi: boolean) {
    if (fam in open) return open[fam];
    return multi; // default: expanded if has multiple rows
  }

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
            <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
              <th className="py-2.5 pl-4 pr-3 font-medium">Product range / variation</th>
              <th className="py-2.5 px-3 font-medium text-right">Current</th>
              <th className="py-2.5 px-3 font-medium text-right">Updated</th>
              <th className="py-2.5 pr-4 pl-3 font-medium text-right w-40">New quantity</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const multi = g.rows.length > 1;
              const expanded = isOpen(g.family, multi);

              if (!multi) {
                // Single-product range: render inline (no expand toggle)
                const p = g.rows[0];
                const updated = fmtShort(p.recorded_at);
                return (
                  <tr key={p.id} className="border-b border-gray-100">
                    <td className="py-2.5 pl-4 pr-3">
                      <div className="font-medium text-gray-900">{g.family}</div>
                      <div className="text-xs text-gray-400">{p.sku}</div>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-gray-600">
                      {p.current.toLocaleString("en-MY")}
                    </td>
                    <td className="py-2.5 px-3 text-right text-gray-400 text-xs">
                      {updated ?? "—"}
                    </td>
                    <td className="py-2.5 pr-4 pl-3 text-right">
                      <input
                        type="number"
                        disabled={!canEdit}
                        value={values[p.id] ?? ""}
                        onChange={(e) =>
                          setValues((v) => ({ ...v, [p.id]: e.target.value }))
                        }
                        className="w-32 text-right border border-gray-300 rounded-md px-2 py-1 disabled:bg-gray-50 disabled:text-gray-400"
                      />
                    </td>
                  </tr>
                );
              }

              return (
                <Fragment key={g.family}>
                  {/* Family header row */}
                  <tr
                    className="border-b border-gray-100 bg-white cursor-pointer hover:bg-gray-50"
                    onClick={() =>
                      setOpen((o) => ({ ...o, [g.family]: !isOpen(g.family, true) }))
                    }
                  >
                    <td className="py-2.5 pl-4 pr-3 font-medium text-gray-900" colSpan={4}>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-gray-400 text-xs w-3">
                          {expanded ? "▾" : "▸"}
                        </span>
                        {g.family}
                        <span className="text-xs text-gray-400 font-normal">
                          ({g.rows.length} variations)
                        </span>
                      </span>
                    </td>
                  </tr>
                  {/* Variation sub-rows */}
                  {expanded &&
                    g.rows.map((p) => {
                      const updated = fmtShort(p.recorded_at);
                      return (
                        <tr
                          key={p.id}
                          className="border-b border-gray-100 bg-gray-50/40 text-gray-600"
                        >
                          <td className="py-2 pl-10 pr-3">
                            <div className="text-gray-800">
                              {p.variation || p.name}
                            </div>
                            <div className="text-xs text-gray-400">{p.sku}</div>
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums">
                            {p.current.toLocaleString("en-MY")}
                          </td>
                          <td className="py-2 px-3 text-right text-gray-400 text-xs">
                            {updated ?? "—"}
                          </td>
                          <td className="py-2 pr-4 pl-3 text-right">
                            <input
                              type="number"
                              disabled={!canEdit}
                              value={values[p.id] ?? ""}
                              onChange={(e) =>
                                setValues((v) => ({ ...v, [p.id]: e.target.value }))
                              }
                              className="w-32 text-right border border-gray-300 rounded-md px-2 py-1 disabled:bg-gray-50 disabled:text-gray-400"
                            />
                          </td>
                        </tr>
                      );
                    })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
