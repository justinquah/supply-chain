"use server";

// Server actions for the Insights demand-uplift callout. The SCM asks the
// Online/Offline team about a detected spike, then records the verdict here:
// SHORT_TERM (promo — no stock action) or LONG_TERM (raise the stock plan).
// Detection itself is computed live in the page from monthly_sales; only the
// verdicts are persisted (demand_signals, UNIQUE product_id+period+channel).

import { revalidatePath } from "next/cache";
import { createClient, requireRole } from "@/lib/supabase/server";

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
