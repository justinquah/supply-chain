"use client";

import { Fragment, useState } from "react";
import { cn } from "@/lib/utils";

export type ProductRow = {
  id: string;
  sku: string;
  name: string;
  variation: string | null;
  product_family: string | null;
  current_stock: number;
  ams_total: number;
  ams_online: number;
  ams_offline: number;
  incoming_total: number;
  coverage_months: number | null;
  inventory_value_myr: number;
  monthly_sales_value_myr?: number;
};

const IDEAL = 1.5;

function n(v: number, dp = 0) {
  return Number(v).toLocaleString("en-MY", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}
function rm(v: number) {
  return "RM " + Number(v).toLocaleString("en-MY", { maximumFractionDigits: 0 });
}

function coverageClass(cov: number | null) {
  if (cov == null) return "text-gray-400";
  if (cov < IDEAL) return "text-red-600 font-semibold";
  if (cov < IDEAL * 1.5) return "text-amber-600";
  return "text-emerald-700";
}

type Group = {
  family: string;
  rows: ProductRow[];
  stock: number;
  ams: number;
  amsOnline: number;
  amsOffline: number;
  incoming: number;
  value: number;
  coverage: number | null;
};

export function GroupedInventory({ products }: { products: ProductRow[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // group by family
  const map = new Map<string, Group>();
  for (const p of products) {
    const fam = p.product_family || p.name;
    const g =
      map.get(fam) ||
      {
        family: fam,
        rows: [],
        stock: 0,
        ams: 0,
        amsOnline: 0,
        amsOffline: 0,
        incoming: 0,
        value: 0,
        coverage: null,
      };
    g.rows.push(p);
    g.stock += Number(p.current_stock || 0);
    g.ams += Number(p.ams_total || 0);
    g.amsOnline += Number(p.ams_online || 0);
    g.amsOffline += Number(p.ams_offline || 0);
    g.incoming += Number(p.incoming_total || 0);
    g.value += Number(p.inventory_value_myr || 0);
    map.set(fam, g);
  }
  const groups = [...map.values()]
    .map((g) => ({
      ...g,
      coverage: g.ams > 0 ? g.stock / g.ams : null,
    }))
    .sort((a, b) => b.ams - a.ams);

  return (
    <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
            <th className="py-2.5 pl-4 pr-3 font-medium">Product range</th>
            <th className="py-2.5 px-3 font-medium text-right">Stock</th>
            <th className="py-2.5 px-3 font-medium text-right">AMS</th>
            <th className="py-2.5 px-3 font-medium text-right">Online</th>
            <th className="py-2.5 px-3 font-medium text-right">Offline</th>
            <th className="py-2.5 px-3 font-medium text-right">Incoming</th>
            <th className="py-2.5 px-3 font-medium text-right">Inv. value</th>
            <th className="py-2.5 pr-4 pl-3 font-medium text-right">Coverage</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const isOpen = open[g.family];
            const multi = g.rows.length > 1;
            return (
              <Fragment key={g.family}>
                <tr
                  className={cn(
                    "border-b border-gray-100 bg-white",
                    multi && "cursor-pointer hover:bg-gray-50"
                  )}
                  onClick={() =>
                    multi && setOpen((o) => ({ ...o, [g.family]: !o[g.family] }))
                  }
                >
                  <td className="py-2.5 pl-4 pr-3 font-medium text-gray-900">
                    <span className="inline-flex items-center gap-1.5">
                      {multi && (
                        <span className="text-gray-400 text-xs w-3">
                          {isOpen ? "▾" : "▸"}
                        </span>
                      )}
                      {!multi && <span className="w-3" />}
                      {g.family}
                      {multi && (
                        <span className="text-xs text-gray-400 font-normal">
                          ({g.rows.length})
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums">
                    {n(g.stock)}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums font-medium">
                    {n(g.ams)}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-gray-500">
                    {n(g.amsOnline)}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-gray-500">
                    {n(g.amsOffline)}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-gray-500">
                    {n(g.incoming)}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-gray-600">
                    {rm(g.value)}
                  </td>
                  <td className="py-2.5 pr-4 pl-3 text-right tabular-nums">
                    <span className={coverageClass(g.coverage)}>
                      {g.coverage == null ? "—" : n(g.coverage, 1) + " mo"}
                    </span>
                  </td>
                </tr>
                {isOpen &&
                  g.rows
                    .sort((a, b) => b.ams_total - a.ams_total)
                    .map((p) => (
                      <tr
                        key={p.id}
                        className="border-b border-gray-100 bg-gray-50/40 text-gray-600"
                      >
                        <td className="py-1.5 pl-10 pr-3">
                          {p.variation || p.name}
                          <span className="text-xs text-gray-400 ml-2">
                            {p.sku}
                          </span>
                        </td>
                        <td className="py-1.5 px-3 text-right tabular-nums">
                          {n(p.current_stock)}
                        </td>
                        <td className="py-1.5 px-3 text-right tabular-nums">
                          {n(p.ams_total)}
                        </td>
                        <td className="py-1.5 px-3 text-right tabular-nums">
                          {n(p.ams_online)}
                        </td>
                        <td className="py-1.5 px-3 text-right tabular-nums">
                          {n(p.ams_offline)}
                        </td>
                        <td className="py-1.5 px-3 text-right tabular-nums">
                          {n(p.incoming_total)}
                        </td>
                        <td className="py-1.5 px-3 text-right tabular-nums">
                          {rm(p.inventory_value_myr)}
                        </td>
                        <td className="py-1.5 pr-4 pl-3 text-right tabular-nums">
                          <span className={coverageClass(p.coverage_months)}>
                            {p.coverage_months == null
                              ? "—"
                              : n(p.coverage_months, 1) + " mo"}
                          </span>
                        </td>
                      </tr>
                    ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
