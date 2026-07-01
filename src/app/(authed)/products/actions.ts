"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type ActionResult = { ok: boolean; error?: string };

/**
 * Update a product's launch date.
 * Gated to SCM/ADMIN. Writes via the admin (service-role) client — the app-layer
 * role check above is the security boundary, same pattern as Settings user-management.
 *
 * launch_date drives the KPI new-SKU exclusion: a SKU only counts toward
 * Overstock %/OOS % once it is more than 6 months past its launch date.
 */
export async function updateLaunchDate(
  productId: string,
  launchDate: string | null
): Promise<ActionResult> {
  await requireRole("SCM", "ADMIN");

  if (!productId) return { ok: false, error: "Missing product" };
  if (launchDate && Number.isNaN(Date.parse(launchDate))) {
    return { ok: false, error: "Invalid date" };
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("products")
    .update({ launch_date: launchDate || null })
    .eq("id", productId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/products");
  return { ok: true };
}
