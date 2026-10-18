import { requireRole, createClient } from "@/lib/supabase/server";
import { ActionList } from "@/components/action-list";
import { PoReorderInsights } from "@/components/po-reorder-insights";
import { DemandUplift, type DemandUpliftRow } from "./demand-uplift";
import type { ProductRow } from "@/components/grouped-inventory";
import { classifyReorder, reorderStatusCounts } from "@/lib/reorder-insights";
import { PushSalesCard, type PushRow } from "./push-sales";
import {
  PUSH_ACTION_WINDOW_DAYS,
  baselineMonths,
  evaluatePushAction,
  isPushPending,
  productPushState,
  type EvaluatedPushAction,
  type PushActionRecord,
  type PushChannel,
} from "@/lib/sales-push";

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
        "id, units_per_shipment, name, product_family, variation, is_main, is_active, discontinue_planned, discontinue_note"
      ),
    supabase
      .from("po_timing_actions")
      .select("po_id, action_type, resolved_at")
      .eq("status", "resolved")
      .gte("resolved_at", resolvedCutoff),
  ]);

  const unitsPerShipmentById = new Map<string, number | null>();
  // Products the SCM has marked to discontinue (phase-out) + their remark.
  const discontinueById = new Map<string, string | null>();
  // Product metadata for the demand-uplift card (active MAIN products only).
  const prodMeta = new Map<
    string,
    { name: string; family: string | null; variation: string | null; activeMain: boolean }
  >();
  for (const r of shipmentRows ?? []) {
    const v = (r as any).units_per_shipment;
    unitsPerShipmentById.set(String((r as any).id), v != null ? Number(v) : null);
    if ((r as any).discontinue_planned) {
      discontinueById.set(String((r as any).id), (r as any).discontinue_note ?? null);
    }
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
    discontinuePlanned: discontinueById.has(String(p.id)),
    discontinueNote: discontinueById.get(String(p.id)) ?? null,
  }));
  // Same classification the PO timing cards render — counted here for the
  // "pending SCM actions" summary.
  const reorderCounts = reorderStatusCounts(
    classifyReorder(reorderProducts, incomingLines, todayISO),
    resolvedExpedite,
    resolvedDelay
  );

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

  // ---- Sales-push actions on overstocked products ----
  // Load the last 180 days of logged actions, the channel sales each one is
  // judged on (measure month + 3 baseline months), and which months are keyed in.
  const pushCutoff = new Date(todayISO + "T00:00:00Z");
  pushCutoff.setUTCDate(pushCutoff.getUTCDate() - 180);
  const [{ data: pushData }, { data: loadedData }] = await Promise.all([
    supabase
      .from("sales_push_actions")
      .select(
        "id, product_id, channel, mechanic, details, cost_myr, start_date, end_date, measure_year, measure_month, coverage_at_action"
      )
      .gte("start_date", pushCutoff.toISOString().slice(0, 10))
      .order("start_date", { ascending: false }),
    supabase.from("sales_months_loaded").select("year, month, channel"),
  ]);
  const pushActions: PushActionRecord[] = (pushData ?? []).map((r: any) => ({
    id: String(r.id),
    productId: String(r.product_id),
    channel: r.channel as PushChannel,
    mechanic: r.mechanic,
    details: r.details ?? null,
    costMyr: r.cost_myr != null ? Number(r.cost_myr) : null,
    startDate: String(r.start_date),
    endDate: r.end_date ?? null,
    measureYear: Number(r.measure_year),
    measureMonth: Number(r.measure_month),
    coverageAtAction: r.coverage_at_action != null ? Number(r.coverage_at_action) : null,
  }));
  const loadedSet = new Set(
    (loadedData ?? []).map((r: any) => `${r.channel}|${r.year}|${r.month}`)
  );

  // Channel units per (product, year, month) for every month an action needs.
  const pushUnits = new Map<string, number>(); // "pid|channel|y|m" -> units
  const pushProductIds = [...new Set(pushActions.map((a) => a.productId))];
  if (pushProductIds.length > 0) {
    const needed = new Set<string>();
    for (const a of pushActions) {
      needed.add(`${a.measureYear}|${a.measureMonth}`);
      for (const b of baselineMonths(a.measureYear, a.measureMonth)) needed.add(`${b.year}|${b.month}`);
    }
    const monthOr = [...needed]
      .map((k) => {
        const [y, m] = k.split("|");
        return `and(year.eq.${y},month.eq.${m})`;
      })
      .join(",");
    for (let from = 0; ; from += PAGE) {
      const { data: batch } = await supabase
        .from("monthly_sales")
        .select("main_product_id, year, month, channel, units_equivalent")
        .in("main_product_id", pushProductIds)
        .or(monthOr)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      const rowsBatch = (batch ?? []) as SalesRow[];
      for (const r of rowsBatch) {
        if (!r.main_product_id || !r.channel) continue;
        const k = `${r.main_product_id}|${r.channel}|${r.year}|${r.month}`;
        pushUnits.set(k, (pushUnits.get(k) ?? 0) + Number(r.units_equivalent || 0));
      }
      if (rowsBatch.length < PAGE) break;
    }
  }
  const evaluated: EvaluatedPushAction[] = pushActions.map((a) =>
    evaluatePushAction(
      a,
      (pid, ch, y, m) => pushUnits.get(`${pid}|${ch}|${y}|${m}`) ?? 0,
      (ch, y, m) => loadedSet.has(`${ch}|${y}|${m}`)
    )
  );
  const actionsByProduct = new Map<string, EvaluatedPushAction[]>();
  for (const a of evaluated) {
    const list = actionsByProduct.get(a.productId) ?? [];
    list.push(a); // already newest-first from the query
    actionsByProduct.set(a.productId, list);
  }
  const toPushRow = (p: any): PushRow => {
    const actions = actionsByProduct.get(String(p.id)) ?? [];
    return {
      productId: String(p.id),
      sku: p.sku,
      label: p.variation || p.name,
      coverage: p.coverage_months != null ? Number(p.coverage_months) : null,
      stock: Number(p.current_stock || 0),
      state: productPushState(actions, todayISO),
      actions,
    };
  };
  const overstockIds = new Set(overstock.map((p) => String(p.id)));
  const pushOverstock = overstock.map(toPushRow);
  // Products acted on recently that are no longer overstocked — the "it worked" trail.
  const windowStart = new Date(todayISO + "T00:00:00Z");
  windowStart.setUTCDate(windowStart.getUTCDate() - PUSH_ACTION_WINDOW_DAYS);
  const windowISO = windowStart.toISOString().slice(0, 10);
  const pushTracked = products
    .filter(
      (p) =>
        !overstockIds.has(String(p.id)) &&
        (actionsByProduct.get(String(p.id)) ?? []).some((a) => a.startDate >= windowISO)
    )
    .map(toPushRow);
  const pushPending = pushOverstock.filter((r) => isPushPending(r.state)).length;
  const pushImproving = pushOverstock.filter((r) => r.state === "IMPROVED").length;
  const pushAwaiting = pushOverstock.filter((r) => r.state === "AWAITING").length;

  // ---- Pending SCM actions: one entry per task type, pending vs done ----
  const upliftPending = upliftRows.filter((r) => r.resolution == null).length;
  const taskSummary: { label: string; href: string; pending: number; doneLabel: string | null }[] = [
    {
      label: "Demand uplift — record verdict",
      href: "#demand-uplift",
      pending: upliftPending,
      doneLabel: upliftRows.length - upliftPending ? `${upliftRows.length - upliftPending} done` : null,
    },
    {
      label: "Expedite PO",
      href: "#po-timing",
      pending: reorderCounts.expedite.pending,
      doneLabel: reorderCounts.expedite.done ? `${reorderCounts.expedite.done} done` : null,
    },
    {
      label: "Issue new PO / discontinue",
      href: "#po-timing",
      pending: reorderCounts.newPo.pending,
      doneLabel: reorderCounts.newPo.discontinuing
        ? `${reorderCounts.newPo.discontinuing} discontinuing`
        : null,
    },
    {
      label: "Delay PO",
      href: "#po-timing",
      pending: reorderCounts.delay.pending,
      doneLabel: reorderCounts.delay.done ? `${reorderCounts.delay.done} done` : null,
    },
    {
      label: "Push sales — log / follow up",
      href: "#push-sales",
      pending: pushPending,
      doneLabel:
        [pushImproving && `${pushImproving} improving`, pushAwaiting && `${pushAwaiting} awaiting`]
          .filter(Boolean)
          .join(" · ") || null,
    },
  ];
  const totalPending = taskSummary.reduce((s, t) => s + t.pending, 0);

  return (
    <div className="space-y-6">
      <Header />

      {/* Pending SCM actions — what still needs a remark or a fix */}
      <div
        className={
          "rounded-lg border p-3 " +
          (totalPending > 0 ? "border-amber-200 bg-amber-50/60" : "border-emerald-200 bg-emerald-50/60")
        }
      >
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="text-sm font-semibold text-gray-800">
            {totalPending > 0
              ? `${totalPending} action${totalPending === 1 ? "" : "s"} pending for SCM`
              : "All caught up — no pending actions"}
          </div>
          <div className="text-[11px] text-gray-500">
            Pending = still needs a remark or fix from SCM · click a box to jump to it
          </div>
        </div>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
          {taskSummary.map((t) => (
            <a
              key={t.label}
              href={t.href}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-2 hover:border-brand/40 transition-colors"
            >
              <div className="text-[11px] text-gray-500">{t.label}</div>
              <div className="mt-0.5 flex items-center gap-2">
                <span
                  className={
                    "text-lg font-semibold tabular-nums " +
                    (t.pending > 0 ? "text-amber-700" : "text-emerald-700")
                  }
                >
                  {t.pending}
                </span>
                <span
                  className={
                    "text-[10px] font-medium px-1.5 py-0.5 rounded-full " +
                    (t.pending > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700")
                  }
                >
                  {t.pending > 0 ? "Pending" : "Done"}
                </span>
                {t.doneLabel && <span className="text-[11px] text-gray-400">{t.doneLabel}</span>}
              </div>
            </a>
          ))}
        </div>
      </div>

      {/* Action lists: replenish (below target) vs push sales (overstock) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ActionList
          title={`Replenish — below ${IDEAL} mo (${understock.length})`}
          tone="bad"
          hint="running low · order / expedite"
          rows={understock.map((p) => ({
            sku: p.sku,
            right:
              `${num(Number(p.coverage_months), 1)} mo · ${num(Number(p.current_stock))} u` +
              (discontinueById.has(String(p.id)) ? " · to discontinue" : ""),
          }))}
          empty="Nothing below target."
        />
        <div id="push-sales" className="scroll-mt-20">
          <PushSalesCard
            overstock={pushOverstock}
            tracked={pushTracked}
            canAct={canEmailSupplier}
            todayISO={todayISO}
          />
        </div>
      </div>

      {/* Demand uplift — spike vs the trailing 3-month average, per channel.
          Only SCM/ADMIN may record verdicts (same gate as canEmailSupplier). */}
      <div id="demand-uplift" className="scroll-mt-20">
        <DemandUplift
          rows={upliftRows}
          period={periodISO}
          monthLabel={monthLabel}
          canAct={canEmailSupplier}
        />
      </div>

      {/* PO timing & reorder — expedite / delay / new PO */}
      <div id="po-timing" className="space-y-2 scroll-mt-20">
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
          canAct={canEmailSupplier}
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
