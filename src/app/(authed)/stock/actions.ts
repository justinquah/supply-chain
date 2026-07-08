"use server";

import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
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

type UnknownSku = { sku: string; qty: number };

export type ImportStockResult = {
  ok: boolean;
  error?: string;
  imported?: number;
  totalUnits?: number;
  unknownSkus?: UnknownSku[];
  snapshotDate?: string;
};

// Resolve a header value case/space-insensitively against a list of
// candidate labels (the source Excel/CSV exports are inconsistent about
// header naming and casing).
const SKU_HEADERS = ["commodity code", "sku", "system product code", "item code", "product code"];
// Quantity aliases in priority order (first present column wins). "Available quantity" is the
// on-hand figure the SCM's inventory export reports.
const QTY_HEADERS = ["available quantity", "inventory level", "quantity", "qty", "stock", "balance qty", "balance", "on hand"];
const DATE_HEADERS = ["week_start", "week start", "date", "snapshot date"];

// Parse the first sheet into { sku, qty, date? }[]. Handles both single-row headers AND
// two-row-header exports — e.g. the "Inventory Inquiry Export" where row 1 is group labels
// ("Product information" / "Inventory information") and the real headers are on row 2
// (SKU = "Commodity code", qty = "Available quantity"). We scan the first rows for a header
// row that contains a recognised SKU column AND a quantity column, then read data below it.
function parseStockRows(wb: XLSX.WorkBook): { sku: string; qty: number; date: string | null }[] {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  const norm = (v: unknown) => String(v == null ? "" : v).trim().toLowerCase();

  let headerIdx = -1;
  let skuCol = -1;
  let qtyCol = -1;
  let dateCol = -1;
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const row = (rows[i] ?? []).map(norm);
    const s = row.findIndex((c) => SKU_HEADERS.includes(c));
    let qy = -1;
    for (const alias of QTY_HEADERS) {
      const j = row.indexOf(alias);
      if (j >= 0) { qy = j; break; }
    }
    if (s >= 0 && qy >= 0) {
      headerIdx = i;
      skuCol = s;
      qtyCol = qy;
      dateCol = row.findIndex((c) => DATE_HEADERS.includes(c));
      break;
    }
  }
  if (headerIdx < 0) return [];

  const out: { sku: string; qty: number; date: string | null }[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!Array.isArray(r)) continue;
    const sku = String(r[skuCol] ?? "").trim();
    if (!sku) continue;
    const qty = Number(r[qtyCol]);
    if (!Number.isFinite(qty)) continue;
    let date: string | null = null;
    if (dateCol >= 0) {
      const rawDate = r[dateCol];
      if (rawDate instanceof Date) {
        date = rawDate.toISOString().slice(0, 10);
      } else if (typeof rawDate === "string" && rawDate.trim()) {
        const parsed = new Date(rawDate.trim());
        if (!Number.isNaN(parsed.getTime())) date = parsed.toISOString().slice(0, 10);
      }
    }
    out.push({ sku, qty, date });
  }
  return out;
}

export async function importStock(formData: FormData): Promise<ImportStockResult> {
  const profile = await getCurrentUser();
  if (!profile) return { ok: false, error: "Not signed in" };
  if (!(["SCM", "ADMIN"] as string[]).includes(profile.role)) {
    return { ok: false, error: "You don't have permission to upload stock" };
  }

  const snapshotDateInput = String(formData.get("snapshotDate") || "").trim();
  const file = formData.get("file");

  if (!snapshotDateInput || !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDateInput)) {
    return { ok: false, error: "Invalid snapshot date" };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file uploaded" };
  }

  let wb: XLSX.WorkBook;
  try {
    const buffer = await file.arrayBuffer();
    wb = XLSX.read(buffer, { type: "array" });
  } catch {
    return { ok: false, error: "Could not read the uploaded file. Is it a valid .xlsx/.xls/.csv?" };
  }

  const supabase = await createClient();

  // ---- Build SKU resolution map ----
  // direct products.sku -> { productId, factor:1 }
  // sku_mappings.variant_sku -> { main_product_id, factor:units_per_variant } (does not
  // override a direct product match). factor = main-equivalent units per 1 of the file's
  // SKU and MAY be fractional (e.g. a single 70g piece = 1/6 of a 70g×6 main pack, or a
  // 500g piece = 1/16 of a 500g×16 pack). Quantities are multiplied by the factor so stock
  // is counted in the SAME main-SKU units as sales (mirrors the sales importer).
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
        factor: Number(m.units_per_variant) || 1,
      });
    }
  }

  // ---- Parse the uploaded file ----
  const parsedRows = parseStockRows(wb);

  // ---- Aggregate: sum quantities per resolved product; collect unknowns ----
  const qtyByProduct = new Map<string, number>();
  const unknownAgg = new Map<string, number>(); // sku -> qty
  for (const row of parsedRows) {
    const upper = row.sku.toUpperCase();
    // Direct match, else retry without a trailing "-UV" warehouse suffix
    // (the inventory export writes e.g. BC-CATLITTER-COFFEE-6L-UV for BC-CATLITTER-COFFEE-6L).
    const hit = resolveMap.get(upper) ?? resolveMap.get(upper.replace(/-UV$/, ""));
    if (!hit) {
      unknownAgg.set(row.sku, (unknownAgg.get(row.sku) || 0) + row.qty);
      continue;
    }
    const snapshotDate = row.date || snapshotDateInput;
    const key = `${hit.productId}|${snapshotDate}`;
    // Convert to main-SKU-equivalent units (factor may be fractional).
    qtyByProduct.set(key, (qtyByProduct.get(key) || 0) + row.qty * hit.factor);
  }

  // ---- Idempotent per-day write: clear existing WEEKLY_UPLOAD snapshots for
  // each (product, date) touched by this upload, then insert fresh rows ----
  let imported = 0;
  let totalUnits = 0;
  const datesTouched = new Set<string>();
  for (const key of qtyByProduct.keys()) {
    const [, date] = key.split("|");
    datesTouched.add(date);
  }
  for (const date of datesTouched) {
    const { error: delErr } = await supabase
      .from("stock_snapshots")
      .delete()
      .eq("source", "WEEKLY_UPLOAD")
      .gte("recorded_at", `${date}T00:00:00+08:00`)
      .lt("recorded_at", `${date}T23:59:59.999+08:00`);
    if (delErr) return { ok: false, error: `Could not clear existing rows: ${delErr.message}` };
  }

  const inserts: { product_id: string; quantity: number; source: "WEEKLY_UPLOAD"; recorded_at: string }[] = [];
  for (const [key, qty] of qtyByProduct) {
    const [productId, date] = key.split("|");
    inserts.push({
      product_id: productId,
      quantity: Math.round(qty),
      source: "WEEKLY_UPLOAD",
      recorded_at: `${date}T09:00:00+08:00`,
    });
    totalUnits += Math.round(qty);
  }

  if (inserts.length > 0) {
    const { error: insErr } = await supabase.from("stock_snapshots").insert(inserts);
    if (insErr) return { ok: false, error: `Could not save stock rows: ${insErr.message}` };
    imported = inserts.length;
  }

  revalidatePath("/stock");
  revalidatePath("/dashboard");

  return {
    ok: true,
    imported,
    totalUnits,
    unknownSkus: [...unknownAgg.entries()].map(([sku, qty]) => ({ sku, qty })),
    snapshotDate: snapshotDateInput,
  };
}
