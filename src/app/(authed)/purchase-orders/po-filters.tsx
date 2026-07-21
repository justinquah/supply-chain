"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export type FilterOption = { value: string; label: string };

const selectCls =
  "border border-gray-300 rounded-md px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/40";

/**
 * PO list filters. The list itself is a server component, so the selected values
 * live in the URL (?supplier=&month=&status=) — shareable and refresh-proof.
 * Changing a select does a client-side router.replace, which re-renders the
 * server component without a full page reload.
 */
export function PoFilters({
  suppliers,
  months,
  statuses,
  current,
}: {
  suppliers: FilterOption[];
  months: FilterOption[];
  statuses: FilterOption[];
  current: { supplier: string; month: string; status: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const active = !!(current.supplier || current.month || current.status);

  function apply(patch: Partial<typeof current>) {
    const nextState = { ...current, ...patch };
    const params = new URLSearchParams();
    if (nextState.supplier) params.set("supplier", nextState.supplier);
    if (nextState.month) params.set("month", nextState.month);
    if (nextState.status) params.set("status", nextState.status);
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `/purchase-orders?${qs}` : "/purchase-orders", {
        scroll: false,
      });
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="text-xs text-gray-500 block mb-1">Supplier</span>
        <select
          value={current.supplier}
          onChange={(e) => apply({ supplier: e.target.value })}
          className={selectCls}
        >
          <option value="">All suppliers</option>
          {suppliers.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-xs text-gray-500 block mb-1">Arrival month</span>
        <select
          value={current.month}
          onChange={(e) => apply({ month: e.target.value })}
          className={selectCls}
        >
          <option value="">All months</option>
          {months.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-xs text-gray-500 block mb-1">Status</span>
        <select
          value={current.status}
          onChange={(e) => apply({ status: e.target.value })}
          className={selectCls}
        >
          <option value="">All statuses</option>
          {statuses.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {active && (
        <button
          type="button"
          onClick={() => apply({ supplier: "", month: "", status: "" })}
          className="text-sm text-brand hover:underline py-1.5"
        >
          Clear filters
        </button>
      )}
      {pending && <span className="text-xs text-gray-400 py-2">Filtering…</span>}
    </div>
  );
}
