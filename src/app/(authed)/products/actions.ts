"use server";

import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { createClient, getCurrentUser, requireRole } from "@/lib/supabase/server";
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

/**
 * Update a product's units-per-carton (the carton↔unit converter) — how many
 * sellable MAIN units are in one carton. Gated to SCM/ADMIN; writes via the
 * admin client, same boundary as updateLaunchDate. Stored as an integer.
 * Revalidates /dashboard too because pack fields feed the ordering/stock math.
 */
export async function updateUnitsPerCarton(
  productId: string,
  value: number
): Promise<ActionResult> {
  await requireRole("SCM", "ADMIN");

  if (!productId) return { ok: false, error: "Missing product" };
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: "Units / carton must be a number greater than 0" };
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("products")
    .update({ units_per_carton: Math.round(value) })
    .eq("id", productId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/products");
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Update a product's stock-pieces-per-unit — how many individual pieces the
 * STOCK FILE counts per 1 main unit (the ÷ divisor the stock importer applies).
 * Gated to SCM/ADMIN. May be fractional (NUMERIC column). Revalidates /dashboard
 * because changing the divisor changes computed on-hand stock.
 */
export async function updateStockPiecesPerUnit(
  productId: string,
  value: number
): Promise<ActionResult> {
  await requireRole("SCM", "ADMIN");

  if (!productId) return { ok: false, error: "Missing product" };
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: "Stock pcs / unit must be a number greater than 0" };
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("products")
    .update({ stock_pieces_per_unit: value })
    .eq("id", productId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/products");
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Update a product's category (products.category_id → product_categories).
 * Gated to SCM/ADMIN; writes via the admin client, same boundary as the other
 * inline product edits. A null categoryId means "Uncategorised". Revalidates
 * the sales-trend + dashboard views since category drives the trend hierarchy.
 */
export async function updateProductCategory(
  productId: string,
  categoryId: string | null
): Promise<ActionResult> {
  await requireRole("SCM", "ADMIN");

  if (!productId) return { ok: false, error: "Missing product" };

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("products")
    .update({ category_id: categoryId || null })
    .eq("id", productId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/products");
  revalidatePath("/sales/trend");
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Update a product's units-per-shipment — one shipment's loading size (main
 * units). Drives the Insights "Issue new PO" suggestion (order in whole
 * shipments). Gated to SCM/ADMIN; writes via the admin client, same boundary as
 * the other inline product edits. A null value clears it (no loading size);
 * when set it must be > 0. Revalidates /insights since the reorder suggestion
 * reads it.
 */
export async function updateUnitsPerShipment(
  productId: string,
  value: number | null
): Promise<ActionResult> {
  await requireRole("SCM", "ADMIN");

  if (!productId) return { ok: false, error: "Missing product" };
  if (value != null && (!Number.isFinite(value) || value <= 0)) {
    return { ok: false, error: "Loading / shipment must be a number greater than 0" };
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("products")
    .update({ units_per_shipment: value })
    .eq("id", productId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/products");
  revalidatePath("/insights");
  return { ok: true };
}

const CURRENCY_CODES = ["MYR", "USD", "CNY", "THB"] as const;
type CurrencyCode = (typeof CURRENCY_CODES)[number];

/**
 * Add a single product (SCM/ADMIN data entry). RLS on products already
 * allows SCM+ADMIN via the session client (products_write policy), so no
 * admin-client fallback is needed here.
 */
export async function addProduct(input: {
  sku: string;
  name: string;
  product_family?: string;
  variation?: string;
  pack_size?: string;
  unit_cost?: number | null;
  cost_currency?: string;
  launch_date?: string | null;
  is_active?: boolean;
  units_per_carton?: number | null;
  stock_pieces_per_unit?: number | null;
}): Promise<ActionResult> {
  await requireRole("SCM", "ADMIN");

  const sku = input.sku?.trim();
  const name = input.name?.trim();
  if (!sku) return { ok: false, error: "SKU is required" };
  if (!name) return { ok: false, error: "Name is required" };
  if (input.launch_date && Number.isNaN(Date.parse(input.launch_date))) {
    return { ok: false, error: "Invalid launch date" };
  }
  if (
    input.units_per_carton != null &&
    (!Number.isFinite(input.units_per_carton) || input.units_per_carton <= 0)
  ) {
    return { ok: false, error: "Units / carton must be a number greater than 0" };
  }
  if (
    input.stock_pieces_per_unit != null &&
    (!Number.isFinite(input.stock_pieces_per_unit) || input.stock_pieces_per_unit <= 0)
  ) {
    return { ok: false, error: "Stock pcs / unit must be a number greater than 0" };
  }
  const currency = CURRENCY_CODES.includes(input.cost_currency as CurrencyCode)
    ? (input.cost_currency as CurrencyCode)
    : "MYR";

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("products")
    .select("id")
    .eq("sku", sku)
    .maybeSingle();
  if (existing) return { ok: false, error: `SKU "${sku}" already exists` };

  const { error } = await supabase.from("products").insert({
    sku,
    name,
    product_family: input.product_family?.trim() || null,
    variation: input.variation?.trim() || null,
    pack_size: input.pack_size?.trim() || null,
    unit_cost: input.unit_cost ?? null,
    cost_currency: currency,
    launch_date: input.launch_date || null,
    is_active: input.is_active ?? true,
    units_per_carton: input.units_per_carton != null ? Math.round(input.units_per_carton) : 1,
    stock_pieces_per_unit: input.stock_pieces_per_unit ?? 1,
  });

  if (error) {
    if (error.code === "23505") return { ok: false, error: `SKU "${sku}" already exists` };
    return { ok: false, error: error.message };
  }

  revalidatePath("/products");
  return { ok: true };
}

export type ImportProductsResult = {
  ok: boolean;
  error?: string;
  inserted?: number;
  skippedExisting?: number;
  errors?: string[];
};

// Flexible header aliases — SCM inventory exports use varying column names.
const SKU_HEADERS = ["sku", "commodity code", "system product code", "item code", "product code"];
const NAME_HEADERS = ["name", "product name", "product"];
const FAMILY_HEADERS = ["product_family", "range", "product family"];
const VARIATION_HEADERS = ["variation"];
const PACK_HEADERS = ["pack_size", "pack"];
const COST_HEADERS = ["unit_cost", "purchase unit price"];
const CURRENCY_HEADERS = ["currency", "cost_currency"];
const LAUNCH_HEADERS = ["launch_date", "launch date"];

type ParsedProductRow = {
  sku: string;
  name: string;
  product_family: string | null;
  variation: string | null;
  pack_size: string | null;
  unit_cost: number | null;
  cost_currency: CurrencyCode | null;
  launch_date: string | null;
};

// Scan the first rows for a header row containing a recognised SKU column AND
// a name column (mirrors the two-row-header tolerance in stock/actions.ts).
function parseProductRows(wb: XLSX.WorkBook): ParsedProductRow[] {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  const norm = (v: unknown) => String(v == null ? "" : v).trim().toLowerCase();

  let headerIdx = -1;
  let skuCol = -1;
  let nameCol = -1;
  let familyCol = -1;
  let variationCol = -1;
  let packCol = -1;
  let costCol = -1;
  let currencyCol = -1;
  let launchCol = -1;
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const row = (rows[i] ?? []).map(norm);
    const s = row.findIndex((c) => SKU_HEADERS.includes(c));
    const n = row.findIndex((c) => NAME_HEADERS.includes(c));
    if (s >= 0 && n >= 0) {
      headerIdx = i;
      skuCol = s;
      nameCol = n;
      familyCol = row.findIndex((c) => FAMILY_HEADERS.includes(c));
      variationCol = row.findIndex((c) => VARIATION_HEADERS.includes(c));
      packCol = row.findIndex((c) => PACK_HEADERS.includes(c));
      costCol = row.findIndex((c) => COST_HEADERS.includes(c));
      currencyCol = row.findIndex((c) => CURRENCY_HEADERS.includes(c));
      launchCol = row.findIndex((c) => LAUNCH_HEADERS.includes(c));
      break;
    }
  }
  if (headerIdx < 0) return [];

  const out: ParsedProductRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!Array.isArray(r)) continue;
    const sku = String(r[skuCol] ?? "").trim();
    const name = String(r[nameCol] ?? "").trim();
    if (!sku || !name) continue;

    let launch_date: string | null = null;
    if (launchCol >= 0) {
      const raw = r[launchCol];
      if (raw instanceof Date) {
        launch_date = raw.toISOString().slice(0, 10);
      } else if (typeof raw === "string" && raw.trim()) {
        const parsed = new Date(raw.trim());
        if (!Number.isNaN(parsed.getTime())) launch_date = parsed.toISOString().slice(0, 10);
      }
    }

    let unit_cost: number | null = null;
    if (costCol >= 0) {
      const n = Number(r[costCol]);
      if (Number.isFinite(n)) unit_cost = n;
    }

    let cost_currency: CurrencyCode | null = null;
    if (currencyCol >= 0) {
      const c = String(r[currencyCol] ?? "").trim().toUpperCase();
      if (CURRENCY_CODES.includes(c as CurrencyCode)) cost_currency = c as CurrencyCode;
    }

    out.push({
      sku,
      name,
      product_family: familyCol >= 0 ? String(r[familyCol] ?? "").trim() || null : null,
      variation: variationCol >= 0 ? String(r[variationCol] ?? "").trim() || null : null,
      pack_size: packCol >= 0 ? String(r[packCol] ?? "").trim() || null : null,
      unit_cost,
      cost_currency,
      launch_date,
    });
  }
  return out;
}

/**
 * Bulk-upload products (Excel/CSV) — used by the SCM to register any SKUs
 * from their inventory export that aren't yet tracked. Inserts missing SKUs;
 * existing SKUs are left as-is (skipped), so this never clobbers data that's
 * already been curated (cost, supplier, launch date, etc.) on /products.
 */
export async function importProducts(formData: FormData): Promise<ImportProductsResult> {
  const profile = await getCurrentUser();
  if (!profile) return { ok: false, error: "Not signed in" };
  if (!(["SCM", "ADMIN"] as string[]).includes(profile.role)) {
    return { ok: false, error: "You don't have permission to upload products" };
  }

  const file = formData.get("file");
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

  const parsedRows = parseProductRows(wb);
  if (parsedRows.length === 0) {
    return {
      ok: false,
      error:
        "Could not find a header row with a recognised SKU column and Name column. " +
        "Expected e.g. \"sku\"/\"Commodity code\" and \"name\"/\"Product name\".",
    };
  }

  const supabase = await createClient();

  const { data: existingProducts, error: prodErr } = await supabase
    .from("products")
    .select("sku");
  if (prodErr) return { ok: false, error: `Could not load existing products: ${prodErr.message}` };
  const existingSkus = new Set((existingProducts ?? []).map((p) => String(p.sku).trim().toUpperCase()));

  // De-dupe within the file itself (first occurrence wins).
  const seen = new Set<string>();
  const toInsert: {
    sku: string;
    name: string;
    product_family: string | null;
    variation: string | null;
    pack_size: string | null;
    unit_cost: number | null;
    cost_currency: CurrencyCode;
    launch_date: string | null;
  }[] = [];
  let skippedExisting = 0;
  const errors: string[] = [];

  for (const row of parsedRows) {
    const key = row.sku.toUpperCase();
    if (existingSkus.has(key) || seen.has(key)) {
      if (existingSkus.has(key)) skippedExisting++;
      continue;
    }
    seen.add(key);
    toInsert.push({
      sku: row.sku,
      name: row.name,
      product_family: row.product_family,
      variation: row.variation,
      pack_size: row.pack_size,
      unit_cost: row.unit_cost,
      cost_currency: row.cost_currency || "MYR",
      launch_date: row.launch_date,
    });
  }

  let inserted = 0;
  if (toInsert.length > 0) {
    const { error: insErr } = await supabase.from("products").insert(toInsert);
    if (insErr) {
      errors.push(insErr.message);
    } else {
      inserted = toInsert.length;
    }
  }

  revalidatePath("/products");

  return { ok: true, inserted, skippedExisting, errors: errors.length ? errors : undefined };
}
