"use client";

import { useMemo, useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { assignProduct, removeProduct, updateSupplierTerms } from "./actions";
import { CostCell } from "./cost-cell";

const CURRENCIES = ["MYR", "USD", "CNY", "THB"] as const;

type Product = {
  id: string;
  sku: string;
  name: string;
  product_family: string | null;
  variation: string | null;
};

type ProductSupplierRow = {
  id: string;
  product_id: string;
  unit_cost: number;
  cost_currency: string;
  is_primary: boolean;
  products: Product | null;
};

type CostHistoryEntry = {
  product_id: string;
  supplier_id: string;
  unit_cost: number;
  cost_currency: string | null;
  effective_from: string;
  note: string | null;
};

function productLabel(p: Product | null) {
  if (!p) return "—";
  const parts = [p.product_family, p.variation].filter(Boolean);
  const label = parts.length > 0 ? parts.join(" · ") : p.name;
  return `${label} (${p.sku})`;
}

function money(n: number | null | undefined, cur: string | null | undefined) {
  if (n == null) return "—";
  return `${cur || ""} ${Number(n).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`.trim();
}

export function SupplierCard({
  supplier,
  productSuppliers,
  historyByKey,
  allProducts,
}: {
  supplier: {
    id: string;
    name: string | null;
    companyName: string | null;
    email: string | null;
    paymentTerms: string | null;
    depositPercent: number | null;
  };
  productSuppliers: ProductSupplierRow[];
  historyByKey: Record<string, CostHistoryEntry[]>;
  allProducts: Product[];
}) {
  const [isPending, startTransition] = useTransition();

  // Terms editing state
  const [editingTerms, setEditingTerms] = useState(false);
  const [terms, setTerms] = useState(supplier.paymentTerms ?? "");
  const [deposit, setDeposit] = useState(
    supplier.depositPercent != null ? String(supplier.depositPercent) : ""
  );
  const [termsMsg, setTermsMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Assign-product form state
  const [showAssign, setShowAssign] = useState(false);
  const [assignProductId, setAssignProductId] = useState("");
  const [assignCost, setAssignCost] = useState("");
  const [assignCurrency, setAssignCurrency] = useState<string>("MYR");
  const [assignPrimary, setAssignPrimary] = useState(false);
  const [assignMsg, setAssignMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const assignedProductIds = new Set(productSuppliers.map((ps) => ps.product_id));
  const availableProducts = useMemo(
    () => allProducts.filter((p) => !assignedProductIds.has(p.id)),
    [allProducts, assignedProductIds]
  );

  const totalCost = productSuppliers.reduce((sum, ps) => sum + Number(ps.unit_cost || 0), 0);
  const avgCost = productSuppliers.length > 0 ? totalCost / productSuppliers.length : 0;

  function handleSaveTerms() {
    setTermsMsg(null);
    const depositNum = deposit.trim() === "" ? null : Number(deposit);
    startTransition(async () => {
      const res = await updateSupplierTerms(supplier.id, terms, depositNum);
      if (res.ok) {
        setTermsMsg({ ok: true, text: "Saved" });
        setEditingTerms(false);
      } else {
        setTermsMsg({ ok: false, text: res.error ?? "Failed to save" });
      }
    });
  }

  function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    setAssignMsg(null);
    const cost = Number(assignCost);
    if (!assignProductId) {
      setAssignMsg({ ok: false, text: "Choose a product" });
      return;
    }
    startTransition(async () => {
      const res = await assignProduct(supplier.id, assignProductId, cost, assignCurrency, assignPrimary);
      if (res.ok) {
        setAssignMsg({ ok: true, text: "Product assigned" });
        setAssignProductId("");
        setAssignCost("");
        setAssignPrimary(false);
        setShowAssign(false);
      } else {
        setAssignMsg({ ok: false, text: res.error ?? "Failed to assign" });
      }
    });
  }

  function handleRemove(productId: string) {
    if (!confirm("Remove this product from the supplier? Cost history is kept.")) return;
    startTransition(async () => {
      await removeProduct(productId, supplier.id);
    });
  }

  return (
    <Card>
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-start justify-between gap-3 bg-gray-50/60 rounded-t-lg">
        <div>
          <div className="font-semibold text-gray-900">
            {supplier.companyName || supplier.name || "—"}
          </div>
          <div className="text-xs text-gray-500">
            {supplier.name}
            {supplier.email ? ` · ${supplier.email}` : ""}
          </div>
        </div>
        <div className="text-right text-sm">
          <div className="text-xs text-gray-500">
            {productSuppliers.length} product{productSuppliers.length === 1 ? "" : "s"} supplied
          </div>
          {productSuppliers.length > 0 && (
            <div className="text-xs text-gray-400">
              avg cost {money(avgCost, productSuppliers[0]?.cost_currency)}
            </div>
          )}
        </div>
      </div>

      <CardContent className="space-y-4 pt-4">
        {/* Payment terms */}
        <div className="rounded-lg border border-gray-100 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Payment terms
            </div>
            {!editingTerms && (
              <button
                onClick={() => setEditingTerms(true)}
                className="text-xs text-blue-600 hover:underline"
              >
                Edit
              </button>
            )}
          </div>
          {editingTerms ? (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Terms</label>
                <input
                  type="text"
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  placeholder="e.g. 30% deposit, balance on BL"
                  className="border border-gray-300 rounded-md px-2 py-1 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Deposit %</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={deposit}
                  onChange={(e) => setDeposit(e.target.value)}
                  className="border border-gray-300 rounded-md px-2 py-1 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <Button size="sm" disabled={isPending} onClick={handleSaveTerms}>
                {isPending ? "Saving…" : "Save"}
              </Button>
              <button
                onClick={() => {
                  setEditingTerms(false);
                  setTerms(supplier.paymentTerms ?? "");
                  setDeposit(supplier.depositPercent != null ? String(supplier.depositPercent) : "");
                }}
                className="text-xs text-gray-500 hover:underline"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="text-sm text-gray-700">
              {supplier.paymentTerms || <span className="text-gray-300">not set</span>}
              {supplier.depositPercent != null && (
                <span className="text-gray-500"> · {supplier.depositPercent}% deposit</span>
              )}
            </div>
          )}
          {termsMsg && (
            <div className={"text-xs mt-1 " + (termsMsg.ok ? "text-emerald-600" : "text-red-600")}>
              {termsMsg.text}
            </div>
          )}
        </div>

        {/* Products supplied */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Products supplied
            </div>
            {!showAssign && (
              <button
                onClick={() => setShowAssign(true)}
                className="text-xs text-blue-600 hover:underline"
              >
                + Assign a product
              </button>
            )}
          </div>

          {showAssign && (
            <form
              onSubmit={handleAssign}
              className="bg-gray-50 rounded-lg border border-gray-200 p-3 mb-3 flex flex-wrap items-end gap-3"
            >
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Product</label>
                <select
                  value={assignProductId}
                  onChange={(e) => setAssignProductId(e.target.value)}
                  className="border border-gray-300 rounded-md px-2 py-1 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="">Choose…</option>
                  {availableProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {productLabel(p)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Cost/unit</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  required
                  value={assignCost}
                  onChange={(e) => setAssignCost(e.target.value)}
                  className="border border-gray-300 rounded-md px-2 py-1 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Currency</label>
                <select
                  value={assignCurrency}
                  onChange={(e) => setAssignCurrency(e.target.value)}
                  className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-gray-600 pb-1.5">
                <input
                  type="checkbox"
                  checked={assignPrimary}
                  onChange={(e) => setAssignPrimary(e.target.checked)}
                />
                Primary supplier for this product
              </label>
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? "Saving…" : "Assign"}
              </Button>
              <button
                type="button"
                onClick={() => setShowAssign(false)}
                className="text-xs text-gray-500 hover:underline"
              >
                Cancel
              </button>
              {assignMsg && (
                <span className={"text-xs " + (assignMsg.ok ? "text-emerald-600" : "text-red-600")}>
                  {assignMsg.text}
                </span>
              )}
            </form>
          )}

          {productSuppliers.length === 0 ? (
            <div className="text-sm text-gray-400 py-2">No products assigned yet.</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-100 bg-gray-50/60">
                    <th className="py-2 pl-3 pr-2 font-medium">Product</th>
                    <th className="py-2 px-2 font-medium text-right">Current cost</th>
                    <th className="py-2 px-2 font-medium">Trend</th>
                    <th className="py-2 pr-3 pl-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {productSuppliers.map((ps) => {
                    const key = `${supplier.id}:${ps.product_id}`;
                    const history = historyByKey[key] ?? [];
                    return (
                      <tr key={ps.id} className="border-b border-gray-50 last:border-0 align-top">
                        <td className="py-2 pl-3 pr-2">
                          <div className="text-gray-900">{productLabel(ps.products)}</div>
                          {ps.is_primary && (
                            <span className="text-[10px] uppercase bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded">
                              primary
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right">
                          <CostCell
                            productId={ps.product_id}
                            supplierId={supplier.id}
                            unitCost={ps.unit_cost}
                            costCurrency={ps.cost_currency}
                          />
                        </td>
                        <td className="py-2 px-2">
                          <CostTrend history={history} />
                        </td>
                        <td className="py-2 pr-3 pl-2 text-right">
                          <button
                            onClick={() => handleRemove(ps.product_id)}
                            disabled={isPending}
                            className="text-xs text-red-600 hover:underline disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CostTrend({ history }: { history: CostHistoryEntry[] }) {
  if (history.length === 0) {
    return <span className="text-xs text-gray-300">no history</span>;
  }
  if (history.length === 1) {
    const only = history[0];
    return (
      <span className="text-xs text-gray-500">
        {money(only.unit_cost, only.cost_currency)} since {only.effective_from}
      </span>
    );
  }

  const [latest, previous] = history;
  const delta = Number(latest.unit_cost) - Number(previous.unit_cost);
  const arrow = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const arrowColor =
    arrow === "up" ? "text-red-600" : arrow === "down" ? "text-emerald-600" : "text-gray-400";

  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-gray-600 list-none">
        <span className={arrowColor}>
          {money(previous.unit_cost, previous.cost_currency)} {"->"} {money(latest.unit_cost, latest.cost_currency)}
        </span>
        <span className="text-gray-400"> · {history.length} changes</span>
      </summary>
      <ul className="mt-1.5 space-y-0.5 pl-2 border-l border-gray-200">
        {history.map((h, i) => (
          <li key={i} className="text-gray-500">
            {h.effective_from}: {money(h.unit_cost, h.cost_currency)}
            {h.note ? ` — ${h.note}` : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}
