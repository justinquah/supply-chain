import { requireRole, createClient } from "@/lib/supabase/server";
import { ActionList } from "@/components/action-list";
import { PoReorderInsights } from "@/components/po-reorder-insights";
import type { ProductRow } from "@/components/grouped-inventory";

const IDEAL = 1.5;
const OVER = IDEAL * 2; // 3.0 mo = clearly overstocked

function num(v: number, dp = 0) {
  return Number(v).toLocaleString("en-MY", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

export default async function InsightsPage() {
  await requireRole("SCM", "ADMIN", "ACCOUNTS", "FINANCE", "WAREHOUSE", "LOGISTICS");

  const supabase = await createClient();

  // Latest stock-upload week (max snapshot_date).
  const { data: weekRows } = await supabase
    .from("stock_upload_weeks")
    .select("snapshot_date");
  const snapWeeks = (weekRows ?? []).map((r) => r.snapshot_date as string);
  const latestWeek = snapWeeks[snapWeeks.length - 1] ?? null;

  if (!latestWeek) {
    return (
      <div className="space-y-6">
        <Header />
        <p className="text-sm text-gray-500 py-8">No stock snapshots yet.</p>
      </div>
    );
  }

  const [{ data: rows }, { data: incomingRows }] = await Promise.all([
    supabase.rpc("product_dashboard_asof_date", { p_date: latestWeek }),
    supabase
      .from("incoming_stock")
      .select("product_id, quantity, expected_date, purchase_orders(po_number)")
      .eq("status", "EXPECTED"),
  ]);

  const products = ((rows ?? []) as any[]).filter(
    (p) => p.is_main && p.is_active
  ) as ProductRow[] & any[];

  if (products.length === 0) {
    return (
      <div className="space-y-6">
        <Header />
        <p className="text-sm text-gray-500 py-8">
          No active products for the latest stock week.
        </p>
      </div>
    );
  }

  // Action lists: what to replenish (below target) vs push (overstock).
  const understock = products
    .filter((p) => p.ams_total > 0 && p.coverage_months != null && Number(p.coverage_months) < IDEAL)
    .sort((a, b) => Number(a.coverage_months) - Number(b.coverage_months));
  const overstock = products
    .filter((p) => p.ams_total > 0 && p.coverage_months != null && Number(p.coverage_months) > OVER)
    .sort((a, b) => Number(b.coverage_months) - Number(a.coverage_months));

  // Incoming PO lines per product (for the reorder/timing insights): qty + ETA + PO number.
  const incomingLines: Record<string, { qty: number; eta: string | null; po: string | null }[]> = {};
  for (const row of incomingRows ?? []) {
    const pid = row.product_id as string;
    (incomingLines[pid] ??= []).push({
      qty: Number(row.quantity || 0),
      eta: (row.expected_date as string) ?? null,
      po: (row as any).purchase_orders?.po_number ?? null,
    });
  }

  const reorderProducts = products.map((p) => ({
    id: p.id,
    sku: p.sku,
    stock: Number(p.current_stock || 0),
    ams: Number(p.ams_total || 0),
    coverage: p.coverage_months != null ? Number(p.coverage_months) : null,
  }));

  // Today in Asia/Kuala_Lumpur as YYYY-MM-DD for ETA math.
  const nowKL = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" })
  );
  const curYear = nowKL.getFullYear();
  const curMonth = nowKL.getMonth() + 1;
  const todayISO = `${curYear}-${String(curMonth).padStart(2, "0")}-${String(nowKL.getDate()).padStart(2, "0")}`;

  return (
    <div className="space-y-6">
      <Header />

      {/* Action lists: replenish (below target) vs push sales (overstock) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ActionList
          title={`Replenish — below ${IDEAL} mo (${understock.length})`}
          tone="bad"
          hint="running low · order / expedite"
          rows={understock.map((p) => ({
            sku: p.sku,
            right: `${num(Number(p.coverage_months), 1)} mo · ${num(Number(p.current_stock))} u`,
          }))}
          empty="Nothing below target."
        />
        <ActionList
          title={`Push sales — overstock > ${OVER} mo (${overstock.length})`}
          tone="warn"
          hint="excess stock · promote / push harder"
          rows={overstock.map((p) => ({
            sku: p.sku,
            right: `${num(Number(p.coverage_months), 1)} mo · ${num(Number(p.current_stock))} u`,
          }))}
          empty="No ranges heavily overstocked."
        />
      </div>

      {/* PO timing & reorder — expedite / delay / new PO */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">
          PO timing &amp; reorder
          <span className="ml-2 text-xs font-normal text-gray-400">
            stock runway vs incoming PO ETAs
          </span>
        </h2>
        <PoReorderInsights
          products={reorderProducts}
          incoming={incomingLines}
          todayISO={todayISO}
        />
      </div>
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Insights &amp; Actions</h1>
      <p className="text-sm text-gray-500 mt-1">
        What to replenish, push, reorder, expedite or delay — from current stock
        vs sales &amp; incoming POs
      </p>
    </div>
  );
}
