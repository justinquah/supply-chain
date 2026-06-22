"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export async function saveStockLevels(
  entries: { product_id: string; quantity: number }[]
): Promise<{ ok: boolean; saved: number; error?: string }> {
  const profile = await getCurrentUser();
  if (!profile) return { ok: false, saved: 0, error: "Not signed in" };
  if (!(["SCM", "ADMIN"] as string[]).includes(profile.role)) {
    return { ok: false, saved: 0, error: "You don't have permission to edit stock" };
  }

  const supabase = await createClient();
  const rows = entries
    .filter((e) => e.product_id && Number.isFinite(e.quantity))
    .map((e) => ({
      product_id: e.product_id,
      quantity: Math.round(e.quantity),
      source: "MANUAL" as const,
    }));

  if (rows.length === 0) return { ok: true, saved: 0 };

  const { error } = await supabase.from("stock_snapshots").insert(rows);
  if (error) return { ok: false, saved: 0, error: error.message };

  revalidatePath("/stock");
  revalidatePath("/dashboard");
  return { ok: true, saved: rows.length };
}
