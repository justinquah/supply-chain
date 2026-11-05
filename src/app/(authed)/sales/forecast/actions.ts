"use server";

// Monthly sales targets: overall per channel + focus products (each with its
// own online / offline target and a review note). SCM / ADMIN only.

import { revalidatePath } from "next/cache";
import { createClient, requireRole } from "@/lib/supabase/server";

type Result = { ok: boolean; error?: string };

function validMonth(year: number, month: number): string | null {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return "Invalid year";
  if (!Number.isInteger(month) || month < 1 || month > 12) return "Invalid month";
  return null;
}

/** null = no target; otherwise a non-negative whole number of units. */
function cleanTarget(v: number | null): number | null | "invalid" {
  if (v == null) return null;
  if (!Number.isFinite(v) || v < 0) return "invalid";
  return Math.round(v);
}

const revalidate = () => revalidatePath("/sales/forecast");

export async function saveChannelTargets(
  year: number,
  month: number,
  targets: { ONLINE: number | null; OFFLINE: number | null }
): Promise<Result> {
  const profile = await requireRole("SCM", "ADMIN");
  const bad = validMonth(year, month);
  if (bad) return { ok: false, error: bad };

  const supabase = await createClient();
  for (const channel of ["ONLINE", "OFFLINE"] as const) {
    const t = cleanTarget(targets[channel]);
    if (t === "invalid") return { ok: false, error: `Invalid ${channel.toLowerCase()} target` };
    if (t == null) {
      const { error } = await supabase
        .from("sales_channel_targets")
        .delete()
        .eq("year", year)
        .eq("month", month)
        .eq("channel", channel);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await supabase.from("sales_channel_targets").upsert(
        {
          year,
          month,
          channel,
          target_units: t,
          updated_by: profile.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "year,month,channel" }
      );
      if (error) return { ok: false, error: error.message };
    }
  }
  revalidate();
  return { ok: true };
}

export async function saveFocusTarget(
  year: number,
  month: number,
  productId: string,
  targets: { online: number | null; offline: number | null }
): Promise<Result> {
  const profile = await requireRole("SCM", "ADMIN");
  const bad = validMonth(year, month);
  if (bad) return { ok: false, error: bad };
  if (!productId) return { ok: false, error: "Missing product" };
  const online = cleanTarget(targets.online);
  const offline = cleanTarget(targets.offline);
  if (online === "invalid" || offline === "invalid") return { ok: false, error: "Invalid target" };

  const supabase = await createClient();
  const { error } = await supabase.from("sales_focus_targets").upsert(
    {
      year,
      month,
      product_id: productId,
      online_target: online,
      offline_target: offline,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "year,month,product_id" }
  );
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

export async function saveFocusNote(
  year: number,
  month: number,
  productId: string,
  note: string
): Promise<Result> {
  const profile = await requireRole("SCM", "ADMIN");
  const bad = validMonth(year, month);
  if (bad) return { ok: false, error: bad };

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("sales_focus_targets")
    .update(
      {
        review_note: note.trim().slice(0, 2000) || null,
        updated_by: profile.id,
        updated_at: new Date().toISOString(),
      },
      { count: "exact" }
    )
    .eq("year", year)
    .eq("month", month)
    .eq("product_id", productId);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "That product isn't a focus product for this month" };
  revalidate();
  return { ok: true };
}

export async function removeFocusProduct(
  year: number,
  month: number,
  productId: string
): Promise<Result> {
  await requireRole("SCM", "ADMIN");
  const bad = validMonth(year, month);
  if (bad) return { ok: false, error: bad };

  const supabase = await createClient();
  const { error } = await supabase
    .from("sales_focus_targets")
    .delete()
    .eq("year", year)
    .eq("month", month)
    .eq("product_id", productId);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

/**
 * Copy the previous month's focus products (with their targets) into this
 * month. Products already on this month's list are left as they are.
 */
export async function copyFocusFromPreviousMonth(
  year: number,
  month: number
): Promise<Result & { copied?: number }> {
  const profile = await requireRole("SCM", "ADMIN");
  const bad = validMonth(year, month);
  if (bad) return { ok: false, error: bad };
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;

  const supabase = await createClient();
  const [{ data: prev, error: prevErr }, { data: cur, error: curErr }] = await Promise.all([
    supabase
      .from("sales_focus_targets")
      .select("product_id, online_target, offline_target")
      .eq("year", prevYear)
      .eq("month", prevMonth),
    supabase.from("sales_focus_targets").select("product_id").eq("year", year).eq("month", month),
  ]);
  if (prevErr || curErr) return { ok: false, error: (prevErr || curErr)!.message };
  if (!prev?.length) return { ok: false, error: "No focus products last month to copy" };

  const have = new Set((cur ?? []).map((r) => r.product_id));
  const rows = prev
    .filter((r) => !have.has(r.product_id))
    .map((r) => ({
      year,
      month,
      product_id: r.product_id,
      online_target: r.online_target,
      offline_target: r.offline_target,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    }));
  if (rows.length) {
    const { error } = await supabase.from("sales_focus_targets").insert(rows);
    if (error) return { ok: false, error: error.message };
  }
  revalidate();
  return { ok: true, copied: rows.length };
}
