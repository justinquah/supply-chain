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
function cell(row: Record<string, unknown>, keyMap: Map<string, string>, ...labels: string[]): unknown {
  for (const label of labels) {
    const actualKey = keyMap.get(label.trim().toLowerCase());
    if (actualKey !== undefined && row[actualKey] !== undefined && row[actualKey] !== null) {
      return row[actualKey];
    }
  }
  return null;
}

function buildKeyMap(row: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  for (const key of Object.keys(row)) {
    map.set(key.trim().toLowerCase(), key);
  }
  return map;
}

const SKU_HEADERS = ["sku", "system product code", "item code"];
const QTY_HEADERS = ["quantity", "qty", "stock"];
const DATE_HEADERS = ["week_start", "date"];

// Parse the first sheet of the uploaded workbook into { sku, qty, date? }[],
// tolerating flexible header naming/casing.
function parseStockRows(wb: XLSX.WorkBook): { sku: string; qty: number; date: string | null }[] {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const out: { sku: string; qty: number; date: string | null }[] = [];
  for (const r of rows) {
    const keyMap = buildKeyMap(r);
    const sku = String(cell(r, keyMap, ...SKU_HEADERS) || "").trim();
    if (!sku) continue;
    const qty = Number(cell(r, keyMap, ...QTY_HEADERS));
    if (!Number.isFinite(qty)) continue;
    const rawDate = cell(r, keyMap, ...DATE_HEADERS);
    let date: string | null = null;
    if (rawDate instanceof Date) {
      date = rawDate.toISOString().slice(0, 10);
    } else if (typeof rawDate === "string" && rawDate.trim()) {
      const parsed = new Date(rawDate.trim());
      if (!Number.isNaN(parsed.getTime())) date = parsed.toISOString().slice(0, 10);
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
  // direct products.sku -> productId
  // sku_mappings.variant_sku -> main_product_id (does not override a direct
  // product match). Quantity is taken as-is at whatever level the file
  // reports (weekly stock counts are typically already at main-product level).
  const resolveMap = new Map<string, string>();

  const { data: products, error: prodErr } = await supabase.from("products").select("id, sku");
  if (prodErr) return { ok: false, error: `Could not load products: ${prodErr.message}` };
  for (const p of products ?? []) {
    resolveMap.set(String(p.sku).trim().toUpperCase(), p.id);
  }

  const { data: mappings, error: mapErr } = await supabase
    .from("sku_mappings")
    .select("variant_sku, main_product_id");
  if (mapErr) return { ok: false, error: `Could not load SKU mappings: ${mapErr.message}` };
  for (const m of mappings ?? []) {
    const key = String(m.variant_sku).trim().toUpperCase();
    if (!resolveMap.has(key)) {
      resolveMap.set(key, m.main_product_id);
    }
  }

  // ---- Parse the uploaded file ----
  const parsedRows = parseStockRows(wb);

  // ---- Aggregate: sum quantities per resolved product; collect unknowns ----
  const qtyByProduct = new Map<string, number>();
  const unknownAgg = new Map<string, number>(); // sku -> qty
  for (const row of parsedRows) {
    const productId = resolveMap.get(row.sku.toUpperCase());
    if (!productId) {
      unknownAgg.set(row.sku, (unknownAgg.get(row.sku) || 0) + row.qty);
      continue;
    }
    const snapshotDate = row.date || snapshotDateInput;
    const key = `${productId}|${snapshotDate}`;
    qtyByProduct.set(key, (qtyByProduct.get(key) || 0) + row.qty);
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
