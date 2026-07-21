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
  const profile = await requireRole("SCM", "ADMIN", "WAREHOUSE", "LOGISTICS");
  // Only SCM/ADMIN may act on PO timing (see applyPoTiming), so only they get
  // the follow-up "Email supplier" draft. Mirrors the existing gate — no widening.
  const canEmailSupplier = profile.role === "SCM" || profile.role === "ADMIN";

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

  // Resolved timing actions within the last 21 days → move those PO tasks to
  // the "Recently resolved" sub-section on the insights cards.
  const resolvedCutoff = new Date(Date.now() - 21 * 86400000).toISOString();

  const [
    { data: rows },
    { data: incomingRows },
    { data: shipmentRows },
    { data: timingRows },
  ] = await Promise.all([
    supabase.rpc("product_dashboard_asof_date", { p_date: latestWeek }),
    supabase
      .from("incoming_stock")
      .select("product_id, quantity, expected_date, purchase_orders(id, po_number)")
      .eq("status", "EXPECTED"),
    supabase.from("products").select("id, units_per_shipment"),
    supabase
      .from("po_timing_actions")
      .select("po_id, action_type, resolved_at")
      .eq("status", "resolved")
      .gte("resolved_at", resolvedCutoff),
  ]);

  const unitsPerShipmentById = new Map<string, number | null>();
  for (const r of shipmentRows ?? []) {
    const v = (r as any).units_per_shipment;
    unitsPerShipmentById.set(String((r as any).id), v != null ? Number(v) : null);
  }

  const resolvedDelay = new Set<string>();
  const resolvedExpedite = new Set<string>();
  for (const r of timingRows ?? []) {
    const poId = String((r as any).po_id);
    if ((r as any).action_type === "delay") resolvedDelay.add(poId);
    else if ((r as any).action_type === "expedite") resolvedExpedite.add(poId);
  }

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

  // Incoming PO lines per product (for the reorder/timing insights): qty + ETA + PO id/number.
  const incomingLines: Record<
    string,
    { qty: number; eta: string | null; po: string | null; poId: string | null }[]
  > = {};
  for (const row of incomingRows ?? []) {
    const pid = row.product_id as string;
    (incomingLines[pid] ??= []).push({
      qty: Number(row.quantity || 0),
      eta: (row.expected_date as string) ?? null,
      po: (row as any).purchase_orders?.po_number ?? null,
      poId: (row as any).purchase_orders?.id ?? null,
    });
  }

  // Supplier contacts per PO, for the post-Apply "Email supplier" mailto draft.
  // supplier_contact_emails / supplier_cc_emails are the mailing lists;
  // profiles.email is the supplier's LOGIN placeholder and is NOT selected.
  const insightPoIds = [
    ...new Set(
      Object.values(incomingLines)
        .flat()
        .map((l) => l.poId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const poSuppliers: Record<
    string,
    { name: string | null; to: string[]; cc: string[] }
  > = {};
  if (canEmailSupplier && insightPoIds.length > 0) {
    const { data: poSupplierRows } = await supabase
      .from("purchase_orders")
      .select(
        "id, supplier:profiles!supplier_id(name, company_name, supplier_contact_emails, supplier_cc_emails)"
      )
      .in("id", insightPoIds);
    type SupplierEmbed = {
      name?: string | null;
      company_name?: string | null;
      supplier_contact_emails?: string[] | null;
      supplier_cc_emails?: string[] | null;
    };
    const supplierRows = (poSupplierRows ?? []) as unknown as {
      id: string;
      supplier: SupplierEmbed | null;
    }[];
    for (const row of supplierRows) {
      const s = row.supplier;
      if (!s) continue;
      poSuppliers[String(row.id)] = {
        name: s.company_name || s.name || null,
        to: s.supplier_contact_emails ?? [],
        cc: s.supplier_cc_emails ?? [],
      };
    }
  }

  const reorderProducts = products.map((p) => ({
    id: p.id,
    sku: p.sku,
    stock: Number(p.current_stock || 0),
    ams: Number(p.ams_total || 0),
    coverage: p.coverage_months != null ? Number(p.coverage_months) : null,
    unitsPerShipment: unitsPerShipmentById.get(String(p.id)) ?? null,
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
          resolvedDelay={[...resolvedDelay]}
          resolvedExpedite={[...resolvedExpedite]}
          poSuppliers={poSuppliers}
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
