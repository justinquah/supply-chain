"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import {
  getManualSalesProducts,
  saveManualSales,
  type ManualSalesProduct,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const MONTHS = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function currentYear() {
  return new Date().getFullYear();
}

type Entry = { online: string; offline: string };

export function ManualSalesForm({
  products,
  initialYear,
  initialMonth,
}: {
  products: ManualSalesProduct[];
  initialYear: number;
  initialMonth: number;
}) {
  const [year, setYear] = useState(String(initialYear));
  const [month, setMonth] = useState(String(initialMonth));
  const [list, setList] = useState(products);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [, startTransition] = useTransition();

  const [entries, setEntries] = useState<Record<string, Entry>>(() =>
    Object.fromEntries(
      products.map((p) => [
        p.id,
        { online: p.online ? String(p.online) : "", offline: p.offline ? String(p.offline) : "" },
      ])
    )
  );

  async function reload(nextYear: number, nextMonth: number) {
    setLoading(true);
    setMsg(null);
    const res = await getManualSalesProducts(nextYear, nextMonth);
    setLoading(false);
    if (!res.ok || !res.products) {
      setMsg({ ok: false, text: res.error ?? "Failed to load products for that period" });
      return;
    }
    setList(res.products);
    setEntries(
      Object.fromEntries(
        res.products.map((p) => [
          p.id,
          { online: p.online ? String(p.online) : "", offline: p.offline ? String(p.offline) : "" },
        ])
      )
    );
  }

  function handleYearChange(v: string) {
    setYear(v);
    startTransition(() => reload(Number(v), Number(month)));
  }
  function handleMonthChange(v: string) {
    setMonth(v);
    startTransition(() => reload(Number(year), Number(v)));
  }

  function setValue(productId: string, field: "online" | "offline", value: string) {
    setEntries((e) => ({ ...e, [productId]: { ...e[productId], [field]: value } }));
  }

  const byFamily = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? list.filter(
          (p) =>
            p.sku.toLowerCase().includes(q) ||
            p.name.toLowerCase().includes(q) ||
            (p.product_family || "").toLowerCase().includes(q) ||
            (p.variation || "").toLowerCase().includes(q)
        )
      : list;
    const map = new Map<string, ManualSalesProduct[]>();
    for (const p of filtered) {
      const fam = p.product_family || p.name;
      if (!map.has(fam)) map.set(fam, []);
      map.get(fam)!.push(p);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [list, search]);

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    const rows = list.map((p) => {
      const e = entries[p.id] || { online: "", offline: "" };
      return {
        product_id: p.id,
        online: e.online.trim() === "" ? null : Number(e.online),
        offline: e.offline.trim() === "" ? null : Number(e.offline),
      };
    });
    const res = await saveManualSales(Number(year), Number(month), rows);
    setSaving(false);
    if (res.ok) {
      setMsg({ ok: true, text: `Saved ${res.saved ?? 0} entr${res.saved === 1 ? "y" : "ies"}.` });
    } else {
      setMsg({ ok: false, text: res.error ?? "Failed to save" });
    }
  }

  const yearOptions = [currentYear() - 1, currentYear(), currentYear() + 1];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Enter sales manually</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-gray-500">
          Fill in online/offline units per product for a month. Existing values
          for the selected month are pre-filled — leave a field blank to skip
          that product, or clear it to zero out that product/channel.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-600">Year</span>
            <select
              value={year}
              onChange={(e) => handleYearChange(e.target.value)}
              className="border border-gray-300 rounded-md px-2 py-1.5 bg-white"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-600">Month</span>
            <select
              value={month}
              onChange={(e) => handleMonthChange(e.target.value)}
              className="border border-gray-300 rounded-md px-2 py-1.5 bg-white"
            >
              {MONTHS.slice(1).map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm flex-1 min-w-[180px]">
            <span className="text-gray-600">Search</span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="SKU, name, range, variation..."
              className="border border-gray-300 rounded-md px-2 py-1.5 bg-white"
            />
          </label>
          <Button type="button" onClick={handleSave} disabled={saving || loading}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>

        {msg && (
          <p className={"text-sm " + (msg.ok ? "text-emerald-600" : "text-red-600")}>{msg.text}</p>
        )}

        {loading ? (
          <p className="text-sm text-gray-500 py-4">Loading...</p>
        ) : (
          <div className="max-h-[32rem] overflow-y-auto border border-gray-100 rounded-md">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2 pl-3 pr-3 font-medium">Product</th>
                  <th className="py-2 px-3 font-medium text-right w-32">Online units</th>
                  <th className="py-2 pr-3 pl-3 font-medium text-right w-32">Offline units</th>
                </tr>
              </thead>
              <tbody>
                {byFamily.map(([fam, items]) => (
                  <Fragment key={fam}>
                    <tr className="bg-gray-50/60">
                      <td colSpan={3} className="py-1.5 pl-3 pr-3 font-medium text-gray-700 text-xs">
                        {fam}
                      </td>
                    </tr>
                    {items.map((p) => {
                      const e = entries[p.id] || { online: "", offline: "" };
                      return (
                        <tr key={p.id} className="border-b border-gray-50 last:border-0">
                          <td className="py-1.5 pl-3 pr-3">
                            <div className="text-gray-900">{p.variation || p.name}</div>
                            <div className="text-xs text-gray-400">{p.sku}</div>
                          </td>
                          <td className="py-1.5 px-3 text-right">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={e.online}
                              onChange={(ev) => setValue(p.id, "online", ev.target.value)}
                              className="w-24 border border-gray-300 rounded-md px-2 py-1 text-right bg-white"
                            />
                          </td>
                          <td className="py-1.5 pr-3 pl-3 text-right">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={e.offline}
                              onChange={(ev) => setValue(p.id, "offline", ev.target.value)}
                              className="w-24 border border-gray-300 rounded-md px-2 py-1 text-right bg-white"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
                {byFamily.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-8 text-center text-gray-500">
                      No products match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
