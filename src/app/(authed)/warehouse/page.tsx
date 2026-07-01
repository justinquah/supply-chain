import { createClient, requireRole } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PO_WORKFLOW_LABELS } from "@/lib/po-workflow";
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
        "unload_completed_at, supplier:profiles!supplier_id(name, company_name)"
    )
    .neq("status", "RECEIVED")
    .neq("status", "CANCELLED")
    .order("created_at", { ascending: false });

  const pos = (posRaw ?? []) as any[];

  const { year: klYear, month: klMonth, todayIso } = klTodayInfo();
  const todayEpoch = new Date(todayIso).getTime();

  // Plot each non-received PO on COALESCE(actual_eta, targeted_eta).
  const arrivals: ArrivalEntry[] = pos
    .filter((po) => po.actual_eta || po.targeted_eta)
    .map((po) => {
      const eta = po.actual_eta ?? po.targeted_eta;
      const etaEpoch = new Date(eta).getTime();
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
    </div>
  );
}
