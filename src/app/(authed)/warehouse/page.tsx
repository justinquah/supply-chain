import Link from "next/link";
import { createClient, requireRole } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PO_WORKFLOW_LABELS, currentEtaToPort } from "@/lib/po-workflow";
import {
  ArrivalCalendar,
  type ArrivalEntry,
  type AwaitingUnloadEntry,
} from "./arrival-calendar";

// Asia/KL "today" for initial calendar month + days-until calculations.
function klTodayInfo(): { year: number; month: number; todayIso: string } {
  const dt = new Date().toLocaleString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = dt.split(/[\/ ,]+/).map(Number);
  const year = parts[2];
  const month = parts[1] - 1; // 0-indexed
  const day = parts[0];
  const todayIso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { year, month, todayIso };
}

// ---------------------------------------------------------------------------
// Page — gated to WAREHOUSE + ADMIN (write); SCM + LOGISTICS may also read,
// consistent with nav gating and the existing PO read RLS.
// ---------------------------------------------------------------------------
export default async function WarehousePage() {
  const profile = await requireRole("WAREHOUSE", "ADMIN", "SCM", "LOGISTICS");
  const isWarehouse = profile.role === "WAREHOUSE" || profile.role === "ADMIN";

  const supabase = await createClient();

  const { data: posRaw } = await supabase
    .from("purchase_orders")
    .select(
      "id, po_number, status, targeted_eta, actual_eta, container_arrived_at, " +
        "supplier_eta, logistics_eta, eta_to_warehouse, clearance_status, " +
        "unload_completed_at, supplier:profiles!supplier_id(name, company_name)"
    )
    .neq("status", "RECEIVED")
    .neq("status", "COMPLETED")
    .neq("status", "CANCELLED")
    .order("created_at", { ascending: false });

  const pos = (posRaw ?? []) as any[];

  const { year: klYear, month: klMonth, todayIso } = klTodayInfo();
  const todayEpoch = new Date(todayIso).getTime();

  function fmtDate(d: string | null | undefined): string {
    if (!d) return "—";
    return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-MY", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }

  // Per-PO ETA overview: current ETA-to-port vs ETA-to-warehouse.
  const etaRows = pos
    .map((po) => {
      const supplier = po.supplier as { name?: string; company_name?: string } | null;
      return {
        poId: po.id as string,
        poNumber: po.po_number as string | null,
        supplierName: supplier?.company_name || supplier?.name || null,
        etaToPort: currentEtaToPort(po),
        etaToWarehouse: (po.eta_to_warehouse ?? null) as string | null,
      };
    })
    .sort((a, b) => {
      const ka = a.etaToWarehouse || a.etaToPort || "9999";
      const kb = b.etaToWarehouse || b.etaToPort || "9999";
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

  // Plot each non-received PO on its ETA to warehouse, falling back to the
  // current ETA-to-port (logistics → supplier → targeted) when the warehouse
  // ETA hasn't been set yet.
  const arrivals: ArrivalEntry[] = pos
    .map((po) => ({ po, eta: po.eta_to_warehouse ?? currentEtaToPort(po) }))
    .filter((x) => !!x.eta)
    .map(({ po, eta }) => {
      // Both sides are plain calendar dates at UTC midnight (todayEpoch is too)
      // so the day-difference is off-by-one-safe.
      const etaEpoch = new Date(`${eta}T00:00:00Z`).getTime();
      const daysUntil = Math.round((etaEpoch - todayEpoch) / 86400000);
      const supplier = po.supplier as { name?: string; company_name?: string } | null;
      return {
        date: eta as string,
        poId: po.id as string,
        poNumber: po.po_number as string | null,
        supplierName: supplier?.company_name || supplier?.name || null,
        status: po.status as string,
        statusLabel: PO_WORKFLOW_LABELS[po.status] || po.status,
        daysUntil,
      };
    });

  // Upcoming arrivals list (sorted by ETA, includes overdue).
  const upcomingArrivals = [...arrivals].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );

  // To receive: in-transit POs (SHIPPED) the warehouse team can jump straight
  // into the GRN form for. Sorted by the best-known arrival (ETA-to-warehouse,
  // else the current ETA-to-port).
  const toReceive = pos
    .filter((po) => po.status === "SHIPPED")
    .map((po) => {
      const supplier = po.supplier as { name?: string; company_name?: string } | null;
      return {
        poId: po.id as string,
        poNumber: po.po_number as string | null,
        supplierName: supplier?.company_name || supplier?.name || null,
        eta: (po.eta_to_warehouse ?? currentEtaToPort(po)) as string | null,
      };
    })
    .sort((a, b) => {
      const ka = a.eta || "9999";
      const kb = b.eta || "9999";
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

  // Awaiting-unload: container has arrived but unload not completed.
  const awaitingUnload: AwaitingUnloadEntry[] = pos
    .filter((po) => po.container_arrived_at && !po.unload_completed_at)
    .map((po) => {
      const supplier = po.supplier as { name?: string; company_name?: string } | null;
      return {
        poId: po.id as string,
        poNumber: po.po_number as string | null,
        supplierName: supplier?.company_name || supplier?.name || null,
        containerArrivedAt: po.container_arrived_at as string,
      };
    })
    .sort((a, b) => (a.containerArrivedAt < b.containerArrivedAt ? -1 : 1));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Warehouse</h1>
        <p className="text-sm text-gray-500 mt-1">
          Expected container arrivals and unloading prep for every PO not yet
          received.
          {!isWarehouse && (
            <span className="ml-1 text-amber-700">Read-only for your role.</span>
          )}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Arrival calendar</CardTitle>
        </CardHeader>
        <CardContent>
          <ArrivalCalendar
            arrivals={arrivals}
            upcomingArrivals={upcomingArrivals}
            awaitingUnload={awaitingUnload}
            initialYear={klYear}
            initialMonth={klMonth}
            todayKl={todayIso}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>To receive</CardTitle>
          <span className="text-xs text-gray-500">
            In-transit POs ready for goods receipt (GRN)
          </span>
        </CardHeader>
        <CardContent className="p-0">
          {toReceive.length === 0 ? (
            <p className="text-sm text-gray-500 px-6 py-6">
              Nothing in transit right now.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-100 bg-gray-50 text-[11px] uppercase tracking-wide text-left">
                    <th className="py-2 pl-6 pr-3 font-semibold">PO #</th>
                    <th className="py-2 px-3 font-semibold">Supplier</th>
                    <th className="py-2 px-3 font-semibold">ETA to warehouse</th>
                    <th className="py-2 pr-6 pl-3 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {toReceive.map((r) => (
                    <tr key={r.poId} className="border-b border-gray-100">
                      <td className="py-2.5 pl-6 pr-3 font-medium text-gray-900">
                        {r.poNumber || "—"}
                      </td>
                      <td className="py-2.5 px-3 text-gray-600">
                        {r.supplierName || "—"}
                      </td>
                      <td className="py-2.5 px-3 text-gray-700 tabular-nums">
                        {fmtDate(r.eta)}
                      </td>
                      <td className="py-2.5 pr-6 pl-3 text-right">
                        <Link
                          href={`/purchase-orders/${r.poId}`}
                          className="text-brand hover:underline font-medium"
                        >
                          Receive →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ETA overview</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {etaRows.length === 0 ? (
            <p className="text-sm text-gray-500 px-6 py-6">
              No incoming purchase orders.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-100 bg-gray-50 text-[11px] uppercase tracking-wide text-left">
                    <th className="py-2 pl-6 pr-3 font-semibold">PO #</th>
                    <th className="py-2 px-3 font-semibold">Supplier</th>
                    <th className="py-2 px-3 font-semibold">ETA to port</th>
                    <th className="py-2 pr-6 pl-3 font-semibold">ETA to warehouse</th>
                  </tr>
                </thead>
                <tbody>
                  {etaRows.map((r) => (
                    <tr key={r.poId} className="border-b border-gray-100">
                      <td className="py-2.5 pl-6 pr-3 font-medium text-gray-900">
                        {r.poNumber || "—"}
                      </td>
                      <td className="py-2.5 px-3 text-gray-600">
                        {r.supplierName || "—"}
                      </td>
                      <td className="py-2.5 px-3 text-gray-700 tabular-nums">
                        {fmtDate(r.etaToPort)}
                      </td>
                      <td className="py-2.5 pr-6 pl-3 text-gray-700 tabular-nums">
                        {fmtDate(r.etaToWarehouse)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
