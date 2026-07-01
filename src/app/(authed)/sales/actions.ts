"use server";

import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

type UnknownSku = { sku: string; qty: number };

export type ImportSalesResult = {
  ok: boolean;
  error?: string;
  imported?: number;
  knownUnits?: number;
  unknownSkus?: UnknownSku[];
  year?: number;
  month?: number;
  channel?: "ONLINE" | "OFFLINE";
};

// Resolve a header value that may appear with or without a leading space
// (the source Excel exports are inconsistent about this).
function cell(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null) return row[k];
  }
  return null;
}

// Aggregate the ONLINE (Qianyi) export: first sheet, shipped-only rows,
// grouped by (System Product Code, Platform) summing Quantity.
function aggregateOnline(wb: XLSX.WorkBook): Map<string, number> {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const agg = new Map<string, number>();
  for (const r of rows) {
    const status = String(cell(r, " Order Status", "Order Status") || "")
      .trim()
      .toLowerCase();
    if (status !== "shipped") continue;
    const code = String(cell(r, " System Product Code", "System Product Code") || "").trim();
    if (!code) continue;
    const platform = String(cell(r, " Platform", "Platform") || "OTHER").trim();
    const qty = Number(cell(r, " Quantity", "Quantity")) || 0;
    if (qty === 0) continue;
    const key = code + "||" + platform;
    agg.set(key, (agg.get(key) || 0) + qty);
  }
  return agg; // key: "sku||platform" -> qty
}

// Aggregate the OFFLINE (AutoCount) export: "From Autocount" sheet
// (fallback first sheet), grouped by Item Code summing Qty.
function aggregateOffline(wb: XLSX.WorkBook): Map<string, number> {
  const sheet = wb.Sheets["From Autocount"] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const agg = new Map<string, number>();
  for (const r of rows) {
    const code = String(cell(r, "Item Code") || "").trim();
    if (!code) continue;
    const qty = Number(cell(r, "Qty")) || 0;
    if (qty === 0) continue;
    agg.set(code, (agg.get(code) || 0) + qty);
  }
  return agg; // key: sku -> qty
}

export async function importSales(formData: FormData): Promise<ImportSalesResult> {
  const profile = await getCurrentUser();
  if (!profile) return { ok: false, error: "Not signed in" };
  if (!(["SCM", "ADMIN"] as string[]).includes(profile.role)) {
    return { ok: false, error: "You don't have permission to upload sales" };
  }

  const year = Number(formData.get("year"));
  const month = Number(formData.get("month"));
  const channel = String(formData.get("channel") || "").toUpperCase();
  const file = formData.get("file");

  if (!Number.isFinite(year) || year < 2000) {
    return { ok: false, error: "Invalid year" };
  }
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    return { ok: false, error: "Invalid month" };
  }
  if (channel !== "ONLINE" && channel !== "OFFLINE") {
    return { ok: false, error: "Invalid channel" };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file uploaded" };
  }

  let wb: XLSX.WorkBook;
  try {
    const buffer = await file.arrayBuffer();
    wb = XLSX.read(buffer, { type: "array" });
  } catch {
    return { ok: false, error: "Could not read the uploaded file. Is it a valid .xlsx?" };
  }

  const supabase = await createClient();

  // ---- Build SKU resolution map ----
  // direct products.sku -> {productId, factor:1}
  // sku_mappings.variant_sku -> {productId, factor:units_per_variant} (does
  // not override a direct product match)
  const resolveMap = new Map<string, { productId: string; factor: number }>();

  const { data: products, error: prodErr } = await supabase.from("products").select("id, sku");
  if (prodErr) return { ok: false, error: `Could not load products: ${prodErr.message}` };
  for (const p of products ?? []) {
    resolveMap.set(String(p.sku).trim().toUpperCase(), { productId: p.id, factor: 1 });
  }

  const { data: mappings, error: mapErr } = await supabase
    .from("sku_mappings")
    .select("variant_sku, main_product_id, units_per_variant");
  if (mapErr) return { ok: false, error: `Could not load SKU mappings: ${mapErr.message}` };
  for (const m of mappings ?? []) {
    const key = String(m.variant_sku).trim().toUpperCase();
    if (!resolveMap.has(key)) {
      resolveMap.set(key, {
        productId: m.main_product_id,
        factor: Number(m.units_per_variant),
      });
    }
  }

  // ---- Parse the uploaded file ----
  const agg = channel === "ONLINE" ? aggregateOnline(wb) : aggregateOffline(wb);

  // ---- Idempotent: clear existing rows for this period + channel ----
  const { error: delErr } = await supabase
    .from("monthly_sales")
    .delete()
    .eq("year", year)
    .eq("month", month)
    .eq("channel", channel);
  if (delErr) return { ok: false, error: `Could not clear existing rows: ${delErr.message}` };

  const unknownAgg = new Map<string, { count: number; units: number }>(); // sku -> {count, units}
  const inserts: {
    year: number;
    month: number;
    channel: string;
    platform: string | null;
    variant_sku: string;
    main_product_id: string;
    qty_sold_variant: number;
    units_equivalent: number;
  }[] = [];
  let knownUnits = 0;

  for (const [key, qty] of agg) {
    let sku: string;
    let platform: string | null;
    if (channel === "ONLINE") {
      const idx = key.lastIndexOf("||");
      sku = key.slice(0, idx);
      platform = key.slice(idx + 2);
    } else {
      sku = key;
      platform = null;
    }

    const hit = resolveMap.get(sku.trim().toUpperCase());
    if (!hit) {
      const u = unknownAgg.get(sku) || { count: 0, units: 0 };
      u.count += 1;
      u.units += qty;
      unknownAgg.set(sku, u);
      continue;
    }
    const unitsEquivalent = qty * hit.factor;
    knownUnits += unitsEquivalent;
    inserts.push({
      year,
      month,
      channel,
      platform,
      variant_sku: sku,
      main_product_id: hit.productId,
      qty_sold_variant: qty,
      units_equivalent: unitsEquivalent,
    });
  }

  if (inserts.length > 0) {
    const { error: insErr } = await supabase.from("monthly_sales").insert(inserts);
    if (insErr) return { ok: false, error: `Could not save sales rows: ${insErr.message}` };
  }

  // ---- Best-effort audit trail (never fail the import if these error) ----
  try {
    await supabase.from("sales_uploads").upsert(
      {
        year,
        month,
        channel,
        file_name: file.name,
        rows_imported: inserts.length,
        units_total: knownUnits,
      },
      { onConflict: "year,month,channel" }
    );
  } catch {
    // best-effort only
  }

  try {
    const context = `sales upload ${year}-${String(month).padStart(2, "0")} ${channel}`;
    for (const [sku, info] of unknownAgg) {
      // Mirror the CLI script's additive ON CONFLICT behaviour: bump the
      // existing occurrence_count rather than overwriting it.
      const { data: existing } = await supabase
        .from("unknown_skus")
        .select("occurrence_count")
        .eq("sku", sku)
        .maybeSingle();
      await supabase.from("unknown_skus").upsert(
        {
          sku,
          occurrence_count: (existing?.occurrence_count ?? 0) + info.count,
          context,
          resolution: "PENDING",
        },
        { onConflict: "sku" }
      );
    }
  } catch {
    // best-effort only
  }

  revalidatePath("/sales");
  revalidatePath("/dashboard");

  return {
    ok: true,
    imported: inserts.length,
    knownUnits,
    unknownSkus: [...unknownAgg.entries()].map(([sku, info]) => ({ sku, qty: info.units })),
    year,
    month,
    channel: channel as "ONLINE" | "OFFLINE",
  };
}
