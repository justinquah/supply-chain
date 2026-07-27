import { requireRole, createClient } from "@/lib/supabase/server";
import { ActionList } from "@/components/action-list";
import { PoReorderInsights } from "@/components/po-reorder-insights";
import { DemandUplift, type DemandUpliftRow } from "./demand-uplift";
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

  // Today in Asia/Kuala_Lumpur — drives ETA math AND the demand-uplift window
  // (the "last completed month" is KL-relative).
  const nowKL = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" })
  );
  const curYear = nowKL.getFullYear();
  const curMonth = nowKL.getMonth() + 1;
  const todayISO = `${curYear}-${String(curMonth).padStart(2, "0")}-${String(nowKL.getDate()).padStart(2, "0")}`;

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
    supabase
      .from("products")
      .select(
        "id, units_per_shipment, name, product_family, variation, is_main, is_active"
      ),
    supabase
      .from("po_timing_actions")
      .select("po_id, action_type, resolved_at")
      .eq("status", "resolved")
      .gte("resolved_at", resolvedCutoff),
  ]);

  const unitsPerShipmentById = new Map<string, number | null>();
  // Product metadata for the demand-uplift card (active MAIN products only).
  const prodMeta = new Map<
    string,
    { name: string; family: string | null; variation: string | null; activeMain: boolean }
  >();
  for (const r of shipmentRows ?? []) {
    const v = (r as any).units_per_shipment;
    unitsPerShipmentById.set(String((r as any).id), v != null ? Number(v) : null);
    prodMeta.set(String((r as any).id), {
      name: String((r as any).name ?? ""),
      family: (r as any).product_family ?? null,
      variation: (r as any).variation ?? null,
      activeMain: Boolean((r as any).is_main) && Boolean((r as any).is_active),
    });
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

  // ---- Demand uplift: last completed KL month vs the 3 months before it ----
  // The stock plan runs on trailing 3-month averages (AMS), so a real demand
  // shift is absorbed months late. Flag products whose last completed month
  // ran >= +20% above the average of the 3 prior months (per channel), so the
  // SCM can ask the Online/Offline team: short-term (promo) or long-term?
  const prevYM = (y: number, m: number): [number, number] =>
    m === 1 ? [y - 1, 12] : [y, m - 1];
  const [lastY, lastM] = prevYM(curYear, curMonth); // last completed month
  // window = [b3, b2, b1, last] (oldest → newest): 3 baseline months + spike month.
  const demandWindow: { y: number; m: number }[] = [{ y: lastY, m: lastM }];
  {
    let y = lastY;
    let m = lastM;
    for (let i = 0; i < 3; i++) {
      [y, m] = prevYM(y, m);
      demandWindow.unshift({ y, m });
    }
  }
  const periodISO = `${lastY}-${String(lastM).padStart(2, "0")}-01`;
  const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthLabel = `${MONTH_ABBR[lastM - 1]} ${lastY}`;

  // Fetch the 4 months of sales (paginated — rows per product/channel/month
  // may span multiple rows and exceed the PostgREST page size; aggregate here).
  const demandOr = demandWindow
    .map(({ y, m }) => `and(year.eq.${y},month.eq.${m})`)
    .join(",");
  type SalesRow = {
    main_product_id: string | null;
    year: number;
    month: number;
    channel: string | null;
    units_equivalent: number | null;
  };
  const salesRows: SalesRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: batch } = await supabase
      .from("monthly_sales")
      .select("main_product_id, year, month, channel, units_equivalent")
      .or(demandOr)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    const rowsBatch = (batch ?? []) as SalesRow[];
    salesRows.push(...rowsBatch);
    if (rowsBatch.length < PAGE) break;
  }

  // Existing verdicts for the spiking month — these rows are RESOLVED.
  const { data: signalRows } = await supabase
    .from("demand_signals")
    .select("product_id, channel, resolution, note")
    .eq("period", periodISO);
  const verdictByKey = new Map<
    string,
    { resolution: "SHORT_TERM" | "LONG_TERM"; note: string | null }
  >();
  for (const s of signalRows ?? []) {
    verdictByKey.set(`${s.product_id}|${s.channel}`, {
      resolution: s.resolution as "SHORT_TERM" | "LONG_TERM",
      note: (s.note as string | null) ?? null,
    });
  }

  // Aggregate units per (main product, channel) across the 4-month window.
  const demandIdx = (y: number, m: number) =>
    demandWindow.findIndex((w) => w.y === y && w.m === m);
  const demandSeries = new Map<string, number[]>(); // "pid|channel" -> [b3,b2,b1,last]
  for (const r of salesRows) {
    const pid = r.main_product_id;
    const ch = r.channel;
    if (!pid || (ch !== "ONLINE" && ch !== "OFFLINE")) continue;
    const i = demandIdx(Number(r.year), Number(r.month));
    if (i < 0) continue;
    const k = `${pid}|${ch}`;
    const arr = demandSeries.get(k) ?? [0, 0, 0, 0];
    arr[i] += Number(r.units_equivalent || 0);
    demandSeries.set(k, arr);
  }

  // Flag: baseline >= 50 u/mo AND last month >= baseline x 1.20, active main
  // products only. Sort by ABSOLUTE extra units — a +100% spike on 200 units
  // matters less than +50% on 30,000.
  const upliftRows: DemandUpliftRow[] = [];
  for (const [k, arr] of demandSeries) {
    const baseline = (arr[0] + arr[1] + arr[2]) / 3;
    const last = arr[3];
    if (!(baseline >= 50)) continue;
    if (!(last >= baseline * 1.2)) continue;
    const [pid, ch] = k.split("|");
    const meta = prodMeta.get(pid);
    if (!meta || !meta.activeMain) continue;
    const verdict = verdictByKey.get(k) ?? null;
    upliftRows.push({
      productId: pid,
      label: meta.variation || meta.name,
      family: meta.family,
      channel: ch as "ONLINE" | "OFFLINE",
      lastUnits: last,
      baseline,
      upliftPct: ((last - baseline) / baseline) * 100,
      extraUnits: last - baseline,
      resolution: verdict?.resolution ?? null,
      note: verdict?.note ?? null,
    });
  }
  upliftRows.sort((a, b) => b.extraUnits - a.extraUnits);

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

      {/* Demand uplift — spike vs the trailing 3-month average, per channel.
          Only SCM/ADMIN may record verdicts (same gate as canEmailSupplier). */}
      <DemandUplift
        rows={upliftRows}
        period={periodISO}
        monthLabel={monthLabel}
        canAct={canEmailSupplier}
      />

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
