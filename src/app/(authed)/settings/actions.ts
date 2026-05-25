"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { fetchShopeeStock } from "@/lib/shopee";

const CAN_SYNC = ["SUPER_ADMIN", "SCM", "ADMIN"];

export async function syncShopeeStock(): Promise<{
  ok: boolean;
  matched?: number;
  unmatched?: number;
  total?: number;
  error?: string;
}> {
  const profile = await getCurrentUser();
  if (!profile) return { ok: false, error: "Not signed in" };
  if (!CAN_SYNC.includes(profile.role))
    return { ok: false, error: "No permission to sync" };

  const supabase = await createClient();

  // Build SKU -> product resolution (products + sku_mappings)
  const resolve = new Map<string, { id: string; factor: number }>();
  const { data: prods } = await supabase.from("products").select("id, sku");
  for (const p of prods ?? [])
    resolve.set(p.sku.trim().toUpperCase(), { id: p.id, factor: 1 });
  const { data: maps } = await supabase
    .from("sku_mappings")
    .select("variant_sku, main_product_id, units_per_variant");
  for (const m of maps ?? []) {
    const k = m.variant_sku.trim().toUpperCase();
    if (!resolve.has(k))
      resolve.set(k, { id: m.main_product_id, factor: Number(m.units_per_variant) });
  }

  let items: Awaited<ReturnType<typeof fetchShopeeStock>>;
  try {
    items = await fetchShopeeStock();
  } catch (e: any) {
    await supabase.from("sync_log").insert({
      provider: "SHOPEE",
      kind: "STOCK",
      status: "ERROR",
      message: e?.message || "fetch failed",
      run_by: profile.id,
    });
    return { ok: false, error: e?.message || "Shopee fetch failed" };
  }

  // Aggregate to main product units
  const byProduct = new Map<string, number>();
  let unmatched = 0;
  for (const it of items) {
    const hit = it.sku ? resolve.get(it.sku.trim().toUpperCase()) : undefined;
    if (!hit) {
      unmatched++;
      if (it.sku) {
        await supabase
          .from("unknown_skus")
          .upsert(
            { sku: it.sku, context: "shopee sync", resolution: "PENDING" },
            { onConflict: "sku", ignoreDuplicates: true }
          );
      }
      continue;
    }
    byProduct.set(hit.id, (byProduct.get(hit.id) || 0) + it.stock * hit.factor);
  }

  // Write one SHOPEE_API snapshot per matched product
  const now = new Date().toISOString();
  const rows = [...byProduct.entries()].map(([product_id, quantity]) => ({
    product_id,
    quantity: Math.round(quantity),
    source: "SHOPEE_API" as const,
    recorded_at: now,
  }));
  if (rows.length) {
    const { error } = await supabase.from("stock_snapshots").insert(rows);
    if (error) return { ok: false, error: error.message };
  }

  await supabase.from("sync_log").insert({
    provider: "SHOPEE",
    kind: "STOCK",
    status: "OK",
    items_synced: items.length,
    matched: byProduct.size,
    unmatched,
    run_by: profile.id,
  });

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  revalidatePath("/projection");
  return { ok: true, total: items.length, matched: byProduct.size, unmatched };
}
