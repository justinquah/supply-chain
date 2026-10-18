"use server";

// Server actions for the Insights demand-uplift callout. The SCM asks the
// Online/Offline team about a detected spike, then records the verdict here:
// SHORT_TERM (promo — no stock action) or LONG_TERM (raise the stock plan).
// Detection itself is computed live in the page from monthly_sales; only the
// verdicts are persisted (demand_signals, UNIQUE product_id+period+channel).

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient, requireRole } from "@/lib/supabase/server";
import { isPushMechanic, measureMonthFor, type PushChannel } from "@/lib/sales-push";

const CHANNELS = ["ONLINE", "OFFLINE"] as const;
const RESOLUTIONS = ["SHORT_TERM", "LONG_TERM"] as const;

export type DemandChannel = (typeof CHANNELS)[number];
export type DemandResolution = (typeof RESOLUTIONS)[number];

export type ResolveDemandSignalInput = {
  productId: string;
  /** First day of the spiking month, YYYY-MM-DD. */
  period: string;
  channel: DemandChannel;
  /** Uplift as detected, e.g. 68.6 for +68.6%. */
  upliftPct: number;
  resolution: DemandResolution;
  /** Optional — what the sales team said. */
  note?: string;
};

export async function resolveDemandSignal(
  input: ResolveDemandSignalInput
): Promise<{ ok: boolean; error?: string }> {
  const profile = await requireRole("SCM", "ADMIN");

  if (!input.productId) return { ok: false, error: "Missing product" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.period))
    return { ok: false, error: "Invalid period" };
  if (!CHANNELS.includes(input.channel))
    return { ok: false, error: "Invalid channel" };
  if (!RESOLUTIONS.includes(input.resolution))
    return { ok: false, error: "Invalid resolution" };
  if (!Number.isFinite(input.upliftPct))
    return { ok: false, error: "Invalid uplift" };

  const supabase = await createClient();
  const { error } = await supabase.from("demand_signals").upsert(
    {
      product_id: input.productId,
      period: input.period,
      channel: input.channel,
      uplift_pct: input.upliftPct,
      resolution: input.resolution,
      note: input.note?.trim() || null,
      resolved_by: profile.id,
      resolved_at: new Date().toISOString(),
    },
    { onConflict: "product_id,period,channel" }
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/insights");
  return { ok: true };
}

// Mark (or unmark) a low-stock product as being phased out, with an optional
// remark. Clears it from the pending "Issue new PO" queue without deactivating
// the product — it keeps selling down its remaining stock.
export async function setDiscontinuePlan(input: {
  productId: string;
  planned: boolean;
  note?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const profile = await requireRole("SCM", "ADMIN");
  if (!input.productId) return { ok: false, error: "Missing product" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update(
      input.planned
        ? {
            discontinue_planned: true,
            discontinue_note: input.note?.trim() || null,
            discontinue_marked_at: new Date().toISOString(),
            discontinue_marked_by: profile.id,
          }
        : {
            discontinue_planned: false,
            discontinue_note: null,
            discontinue_marked_at: null,
            discontinue_marked_by: null,
          }
    )
    .eq("id", input.productId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/insights");
  return { ok: true };
}

export async function undoDemandSignal(
  productId: string,
  period: string,
  channel: DemandChannel
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("SCM", "ADMIN");

  if (!productId) return { ok: false, error: "Missing product" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period))
    return { ok: false, error: "Invalid period" };
  if (!CHANNELS.includes(channel))
    return { ok: false, error: "Invalid channel" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("demand_signals")
    .delete()
    .eq("product_id", productId)
    .eq("period", period)
    .eq("channel", channel);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/insights");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sales-push actions on overstocked products (migration 0050)
// ---------------------------------------------------------------------------

export type LogSalesPushInput = {
  productIds: string[];
  channel: PushChannel;
  mechanic: string;
  details?: string;
  costMyr?: number | null;
  startDate: string;
  endDate?: string | null;
};

// One row per ticked product, sharing a batch_id. The measure month is fixed now
// from the start date, and each product's coverage is snapshotted server-side so
// the card can show coverage before → now.
export async function logSalesPushAction(
  input: LogSalesPushInput
): Promise<{ ok: boolean; error?: string; logged?: number }> {
  const profile = await requireRole("SCM", "ADMIN");

  const productIds = [...new Set((input.productIds ?? []).filter(Boolean))];
  if (productIds.length === 0) return { ok: false, error: "Tick at least one product" };
  if (input.channel !== "ONLINE" && input.channel !== "OFFLINE")
    return { ok: false, error: "Invalid channel" };
  if (!isPushMechanic(input.channel, input.mechanic))
    return { ok: false, error: "That mechanic doesn't match the channel" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate))
    return { ok: false, error: "Start date is required" };
  const endDate = input.endDate?.trim() || null;
  if (endDate && (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < input.startDate))
    return { ok: false, error: "End date must be on or after the start date" };
  const cost = input.costMyr ?? null;
  if (cost != null && (!Number.isFinite(cost) || cost < 0))
    return { ok: false, error: "Cost must be a positive number" };

  const supabase = await createClient();

  // Coverage now, from the latest stock week (same source as the Insights page).
  const coverage = new Map<string, number | null>();
  const { data: weekRows } = await supabase.from("stock_upload_weeks").select("snapshot_date");
  const latestWeek = (weekRows ?? []).map((r) => r.snapshot_date as string).pop() ?? null;
  if (latestWeek) {
    const { data: dash } = await supabase.rpc("product_dashboard_asof_date", { p_date: latestWeek });
    for (const p of (dash ?? []) as { id: string; coverage_months: number | null }[]) {
      coverage.set(String(p.id), p.coverage_months != null ? Number(p.coverage_months) : null);
    }
  }

  const { year, month } = measureMonthFor(input.startDate);
  const batchId = randomUUID();
  const { error } = await supabase.from("sales_push_actions").insert(
    productIds.map((pid) => ({
      batch_id: batchId,
      product_id: pid,
      channel: input.channel,
      mechanic: input.mechanic,
      details: input.details?.trim() || null,
      cost_myr: cost,
      start_date: input.startDate,
      end_date: endDate,
      measure_year: year,
      measure_month: month,
      coverage_at_action: coverage.get(pid) ?? null,
      created_by: profile.id,
    }))
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/insights");
  return { ok: true, logged: productIds.length };
}

// Remove a mistaken entry.
export async function deleteSalesPushAction(id: string): Promise<{ ok: boolean; error?: string }> {
  await requireRole("SCM", "ADMIN");
  if (!id) return { ok: false, error: "Missing action" };
  const supabase = await createClient();
  const { error } = await supabase.from("sales_push_actions").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/insights");
  return { ok: true };
}
