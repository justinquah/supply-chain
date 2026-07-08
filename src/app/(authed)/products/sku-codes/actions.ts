"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type ActionResult = { ok: boolean; error?: string };

/**
 * SKU-code (variant → main product) mapping management.
 *
 * A "SKU code" is an alternate code that appears in the SCM's inventory / online /
 * offline sales files. Each maps to ONE main product with a conversion factor
 * (`units_per_variant`) = how many MAIN-SKU units ONE of the code equals. The factor
 * MAY be fractional (e.g. a single 70g piece = 1/6 of a 70g×6 main pack → factor 0.1667).
 * Both importers (stock/actions.ts, sales/actions.ts) multiply the file quantity by this
 * factor so every source is counted in the same main-SKU units.
 *
 * Gated to SCM/ADMIN (the RLS write policy on sku_mappings). Writes go through the
 * admin (service-role) client — the app-layer role check here is the security boundary,
 * mirroring products/actions.ts and settings/actions.ts.
 */

function normalizeVariantSku(raw: string | undefined | null): string {
  return String(raw ?? "").trim().toUpperCase();
}

export async function createSkuMapping(input: {
  variant_sku: string;
  main_product_id: string;
  units_per_variant: number;
  variant_name?: string | null;
  notes?: string | null;
}): Promise<ActionResult> {
  await requireRole("SCM", "ADMIN");

  const variantSku = normalizeVariantSku(input.variant_sku);
  const mainProductId = String(input.main_product_id ?? "").trim();
  const factor = Number(input.units_per_variant);

  if (!variantSku) return { ok: false, error: "SKU code is required" };
  if (!mainProductId) return { ok: false, error: "Pick a main product to map to" };
  if (!Number.isFinite(factor) || factor <= 0) {
    return { ok: false, error: "Conversion factor must be greater than 0" };
  }

  const adminClient = createAdminClient();

  // Case-insensitive duplicate check (variant_sku is stored uppercased).
  const { data: existing, error: existErr } = await adminClient
    .from("sku_mappings")
    .select("id")
    .eq("variant_sku", variantSku)
    .maybeSingle();
  if (existErr) return { ok: false, error: existErr.message };
  if (existing) {
    return { ok: false, error: `SKU code "${variantSku}" is already mapped` };
  }

  const { error } = await adminClient.from("sku_mappings").insert({
    variant_sku: variantSku,
    main_product_id: mainProductId,
    units_per_variant: factor,
    variant_name: input.variant_name?.trim() || null,
    notes: input.notes?.trim() || null,
  });

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: `SKU code "${variantSku}" is already mapped` };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/products/sku-codes");
  return { ok: true };
}

export async function updateSkuMapping(input: {
  id: string;
  variant_sku: string;
  main_product_id: string;
  units_per_variant: number;
  variant_name?: string | null;
  notes?: string | null;
}): Promise<ActionResult> {
  await requireRole("SCM", "ADMIN");

  const id = String(input.id ?? "").trim();
  const variantSku = normalizeVariantSku(input.variant_sku);
  const mainProductId = String(input.main_product_id ?? "").trim();
  const factor = Number(input.units_per_variant);

  if (!id) return { ok: false, error: "Missing mapping" };
  if (!variantSku) return { ok: false, error: "SKU code is required" };
  if (!mainProductId) return { ok: false, error: "Pick a main product to map to" };
  if (!Number.isFinite(factor) || factor <= 0) {
    return { ok: false, error: "Conversion factor must be greater than 0" };
  }

  const adminClient = createAdminClient();

  // Guard against colliding with a DIFFERENT mapping that already uses this code.
  const { data: clash, error: clashErr } = await adminClient
    .from("sku_mappings")
    .select("id")
    .eq("variant_sku", variantSku)
    .neq("id", id)
    .maybeSingle();
  if (clashErr) return { ok: false, error: clashErr.message };
  if (clash) {
    return { ok: false, error: `SKU code "${variantSku}" is already mapped` };
  }

  const { error } = await adminClient
    .from("sku_mappings")
    .update({
      variant_sku: variantSku,
      main_product_id: mainProductId,
      units_per_variant: factor,
      variant_name: input.variant_name?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: `SKU code "${variantSku}" is already mapped` };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/products/sku-codes");
  return { ok: true };
}

export async function deleteSkuMapping(id: string): Promise<ActionResult> {
  await requireRole("SCM", "ADMIN");

  const mappingId = String(id ?? "").trim();
  if (!mappingId) return { ok: false, error: "Missing mapping" };

  const adminClient = createAdminClient();
  const { error } = await adminClient.from("sku_mappings").delete().eq("id", mappingId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/products/sku-codes");
  return { ok: true };
}
