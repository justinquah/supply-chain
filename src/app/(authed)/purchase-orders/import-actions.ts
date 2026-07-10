"use server";

import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recomputePoAmount } from "./actions";
import {
  PO_WORKFLOW_STATES,
  PO_WORKFLOW_LABELS,
  CLEARANCE_STATUSES,
  type PoWorkflowState,
} from "@/lib/po-workflow";

// doc_type -> storage bucket (mirrors purchase-orders/actions.ts BUCKET map).
const BUCKET: Record<string, string> = {
  PO_PDF: "po-pdfs",
  SUPPLIER_INVOICE: "invoices",
  BL: "shipping-docs",
  PACKING_LIST: "shipping-docs",
  K1_DRAFT: "shipping-docs",
  K1_FINAL: "shipping-docs",
  LOGISTICS_INVOICE: "invoices",
};

const CURRENCY_CODES = ["MYR", "USD", "CNY", "THB"] as const;
type CurrencyCode = (typeof CURRENCY_CODES)[number];

function slug(s: string) {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

// ---------------------------------------------------------------------------
// FEATURE A — Bulk PO import (Excel/CSV → upsert by po_number)
// ---------------------------------------------------------------------------

export type ImportPurchaseOrdersResult = {
  ok: boolean;
  error?: string;
  created?: number;
  updated?: number;
  skipped?: { row: number; po_number: string; reason: string }[];
};

// Case/space-insensitive header aliases. First match wins.
const HEADER_ALIASES: Record<string, string[]> = {
  po_number: ["po_number", "po number", "po no", "po#", "po", "purchase order", "purchase order number"],
  supplier: ["supplier", "supplier_name", "supplier name", "company", "company_name", "company name"],
  status: ["status", "po_status", "po status", "state"],
  product_group: ["product_group", "product group", "product range", "range", "product_range"],
  currency: ["currency", "invoice_currency", "invoice currency"],
  total_amount: ["total_amount", "total amount", "amount", "total", "invoice_amount", "invoice amount"],
  payment_terms: ["payment_terms", "payment terms", "terms"],
  deposit_percent: ["deposit_percent", "deposit percent", "deposit %", "deposit%", "deposit"],
  deposit_due_date: ["deposit_due_date", "deposit due date", "deposit due"],
  balance_due_date: ["balance_due_date", "balance due date", "balance due"],
  targeted_eta: ["targeted_eta", "targeted eta", "target eta"],
  etd: ["etd"],
  supplier_eta: ["supplier_eta", "supplier eta"],
  logistics_eta: ["logistics_eta", "logistics eta"],
  eta_to_warehouse: ["eta_to_warehouse", "eta to warehouse", "warehouse eta"],
  actual_eta: ["actual_eta", "actual eta", "actual port arrival"],
  invoice_date: ["invoice_date", "invoice date"],
  clearance_status: ["clearance_status", "clearance status", "clearance"],
  invoice_number: ["invoice_number", "invoice number", "invoice no", "invoice#"],
  invoice_amount: ["invoice_amount", "invoice amount"],
  notes: ["notes", "note", "remarks", "remark"],
};

// All logical fields we look for. po_number + supplier are required to detect a header row.
const FIELD_KEYS = Object.keys(HEADER_ALIASES);

type ColMap = Record<string, number>;

// Locate the header row (scan first 8 rows) and map each logical field to its
// column index. A row qualifies as the header if it contains a po_number column.
function detectHeader(rows: unknown[][]): { headerIdx: number; cols: ColMap } | null {
  const norm = (v: unknown) => String(v == null ? "" : v).trim().toLowerCase().replace(/\s+/g, " ");
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const row = (rows[i] ?? []).map(norm);
    const poCol = row.findIndex((c) => HEADER_ALIASES.po_number.includes(c));
    if (poCol < 0) continue;
    const cols: ColMap = {};
    for (const field of FIELD_KEYS) {
      const idx = row.findIndex((c) => HEADER_ALIASES[field].includes(c));
      if (idx >= 0) cols[field] = idx;
    }
    return { headerIdx: i, cols };
  }
  return null;
}

function cell(row: unknown[], cols: ColMap, field: string): string {
  const idx = cols[field];
  if (idx == null) return "";
  const raw = row[idx];
  if (raw == null) return "";
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  return String(raw).trim();
}

// Parse a cell into a plain YYYY-MM-DD string. Accepts:
//  - Date objects (xlsx cellDates),
//  - explicit YYYY-MM-DD strings,
//  - Excel serial numbers (days since 1899-12-30),
//  - anything Date.parse understands.
// Returns null on blank/unparseable.
function parseDate(row: unknown[], cols: ColMap, field: string): string | null {
  const idx = cols[field];
  if (idx == null) return null;
  const raw = row[idx];
  if (raw == null || raw === "") return null;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Excel serial date → JS Date (epoch 1899-12-30, ignore times).
    const parsed = XLSX.SSF ? XLSX.SSF.parse_date_code(raw) : null;
    if (parsed && parsed.y) {
      const m = String(parsed.m).padStart(2, "0");
      const d = String(parsed.d).padStart(2, "0");
      return `${parsed.y}-${m}-${d}`;
    }
    return null;
  }
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function parseNumber(row: unknown[], cols: ColMap, field: string): number | null {
  const idx = cols[field];
  if (idx == null) return null;
  const raw = row[idx];
  if (raw == null || raw === "") return null;
  // Strip currency symbols / thousands separators from string cells.
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Map a human status label OR raw enum to a PO_WORKFLOW_STATE. Returns null when
// a non-blank value doesn't match any known state (caller skips the row).
function resolveStatus(raw: string): PoWorkflowState | null | undefined {
  const v = raw.trim();
  if (!v) return undefined; // blank → default DRAFT (handled by caller)
  const upper = v.toUpperCase().replace(/\s+/g, "_");
  if ((PO_WORKFLOW_STATES as readonly string[]).includes(upper)) return upper as PoWorkflowState;
  // Match against human labels (case-insensitive).
  const lower = v.toLowerCase();
  for (const state of PO_WORKFLOW_STATES) {
    if (PO_WORKFLOW_LABELS[state]?.toLowerCase() === lower) return state;
  }
  return null; // present but invalid
}

export async function importPurchaseOrders(
  formData: FormData
): Promise<ImportPurchaseOrdersResult> {
  const profile = await getCurrentUser();
  if (!profile) return { ok: false, error: "Not signed in" };
  if (!(["SCM", "ADMIN"] as string[]).includes(profile.role)) {
    return { ok: false, error: "You don't have permission to import purchase orders" };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file uploaded" };
  }

  let wb: XLSX.WorkBook;
  try {
    const buffer = await file.arrayBuffer();
    wb = XLSX.read(buffer, { type: "array", cellDates: true });
  } catch {
    return { ok: false, error: "Could not read the uploaded file. Is it a valid .xlsx/.xls/.csv?" };
  }

  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  const detected = detectHeader(rows);
  if (!detected) {
    return {
      ok: false,
      error:
        'Could not find a header row with a recognised "po_number" column. ' +
        "Add a header row that includes a PO number column (e.g. \"po_number\" or \"PO number\").",
    };
  }
  const { headerIdx, cols } = detected;

  const admin = createAdminClient();

  // Preload suppliers (profiles with a company_name) for case-insensitive matching.
  const { data: supplierRows, error: supErr } = await admin
    .from("profiles")
    .select("id, name, company_name")
    .not("company_name", "is", null);
  if (supErr) return { ok: false, error: `Could not load suppliers: ${supErr.message}` };

  const supplierByKey = new Map<string, string[]>(); // key -> [id,...] (detect ambiguity)
  const addSupplierKey = (key: string, id: string) => {
    const k = key.trim().toLowerCase();
    if (!k) return;
    const arr = supplierByKey.get(k) ?? [];
    if (!arr.includes(id)) arr.push(id);
    supplierByKey.set(k, arr);
  };
  for (const s of supplierRows ?? []) {
    if (s.company_name) addSupplierKey(String(s.company_name), s.id);
    if (s.name) addSupplierKey(String(s.name), s.id);
  }

  // Preload existing POs by po_number (uppercased) → id, for upsert routing.
  const { data: existingPos, error: poErr } = await admin
    .from("purchase_orders")
    .select("id, po_number");
  if (poErr) return { ok: false, error: `Could not load purchase orders: ${poErr.message}` };
  const existingByNumber = new Map<string, string>();
  for (const p of existingPos ?? []) {
    if (p.po_number) existingByNumber.set(String(p.po_number).trim().toUpperCase(), p.id);
  }

  let created = 0;
  let updated = 0;
  const skipped: { row: number; po_number: string; reason: string }[] = [];
  const seenInFile = new Set<string>();

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const excelRow = i + 1; // 1-based row number for user-facing messages

    const poNumber = cell(row, cols, "po_number");
    if (!poNumber) {
      // Silently skip fully-blank rows; only report rows that carried some data.
      const hasAnyData = row.some((c) => c != null && String(c).trim() !== "");
      if (hasAnyData) skipped.push({ row: excelRow, po_number: "", reason: "po_number is blank" });
      continue;
    }

    const key = poNumber.toUpperCase();
    if (seenInFile.has(key)) {
      skipped.push({ row: excelRow, po_number: poNumber, reason: "duplicate po_number in file" });
      continue;
    }
    seenInFile.add(key);

    const existingId = existingByNumber.get(key);
    const isInsert = !existingId;

    // Resolve supplier (required for INSERT — supplier_id is NOT NULL).
    const supplierRaw = cell(row, cols, "supplier");
    let supplierId: string | null = null;
    if (supplierRaw) {
      const matches = supplierByKey.get(supplierRaw.trim().toLowerCase());
      if (!matches || matches.length === 0) {
        skipped.push({ row: excelRow, po_number: poNumber, reason: `supplier not found: ${supplierRaw}` });
        continue;
      }
      if (matches.length > 1) {
        skipped.push({ row: excelRow, po_number: poNumber, reason: `supplier not unique: ${supplierRaw}` });
        continue;
      }
      supplierId = matches[0];
    }
    if (isInsert && !supplierId) {
      skipped.push({
        row: excelRow,
        po_number: poNumber,
        reason: supplierRaw ? `supplier not found: ${supplierRaw}` : "supplier required for new PO",
      });
      continue;
    }

    // Status (default DRAFT on insert; invalid non-blank → skip).
    const status = resolveStatus(cell(row, cols, "status"));
    if (status === null) {
      skipped.push({ row: excelRow, po_number: poNumber, reason: `invalid status: ${cell(row, cols, "status")}` });
      continue;
    }

    // Currency → currency_code enum (default MYR).
    const currencyRaw = cell(row, cols, "currency").toUpperCase();
    const currency: CurrencyCode | null = CURRENCY_CODES.includes(currencyRaw as CurrencyCode)
      ? (currencyRaw as CurrencyCode)
      : null;

    // Clearance status validated against the enum; ignored silently if invalid.
    const clearanceRaw = cell(row, cols, "clearance_status").toUpperCase().replace(/\s+/g, "_");
    const clearance = (CLEARANCE_STATUSES as readonly string[]).includes(clearanceRaw)
      ? clearanceRaw
      : null;

    // Build the patch — only include fields that were present + non-blank so a
    // partial file never wipes existing data.
    const patch: Record<string, unknown> = {};
    const setStr = (col: string, field: string) => {
      const v = cell(row, cols, field);
      if (v) patch[col] = v;
    };
    const setNum = (col: string, field: string) => {
      const v = parseNumber(row, cols, field);
      if (v != null) patch[col] = v;
    };
    const setDate = (col: string, field: string) => {
      const v = parseDate(row, cols, field);
      if (v != null) patch[col] = v;
    };

    if (supplierId) patch.supplier_id = supplierId;
    if (status) patch.status = status;
    setStr("product_group", "product_group");
    if (currency) {
      patch.invoice_currency = currency;
      // Legacy `currency` column has CHECK IN ('MYR','USD') — only write it there
      // when compatible so CNY/THB don't violate the constraint.
      if (currency === "MYR" || currency === "USD") patch.currency = currency;
    }
    // total_amount (NUMERIC NOT NULL DEFAULT 0). Also mirror to expected_invoice_amount
    // so the PO list amount column renders for freshly-imported POs.
    const totalAmount = parseNumber(row, cols, "total_amount");
    if (totalAmount != null) {
      patch.total_amount = totalAmount;
      patch.expected_invoice_amount = totalAmount;
    }
    setStr("payment_terms", "payment_terms");
    setNum("deposit_percent", "deposit_percent");
    setDate("deposit_due_date", "deposit_due_date");
    setDate("balance_due_date", "balance_due_date");
    setDate("targeted_eta", "targeted_eta");
    setDate("etd", "etd");
    setDate("supplier_eta", "supplier_eta");
    setDate("logistics_eta", "logistics_eta");
    setDate("eta_to_warehouse", "eta_to_warehouse");
    setDate("actual_eta", "actual_eta");
    setDate("invoice_date", "invoice_date");
    if (clearance) patch.clearance_status = clearance;
    setStr("invoice_number", "invoice_number");
    setNum("invoice_amount", "invoice_amount");
    setStr("notes", "notes");

    if (isInsert) {
      const insert: Record<string, unknown> = {
        po_number: poNumber,
        status: status ?? "DRAFT",
        proposal_source: "MANUAL_SCM",
        proposed_by: profile.id,
        ...patch,
      };
      const { error } = await admin.from("purchase_orders").insert(insert);
      if (error) {
        skipped.push({ row: excelRow, po_number: poNumber, reason: error.message });
        continue;
      }
      created++;
    } else {
      // Nothing but the po_number present → treat as a no-op update but still count it.
      const { error } = await admin.from("purchase_orders").update(patch).eq("id", existingId);
      if (error) {
        skipped.push({ row: excelRow, po_number: poNumber, reason: error.message });
        continue;
      }
      updated++;
    }
  }

  revalidatePath("/purchase-orders");
  return { ok: true, created, updated, skipped };
}

// ---------------------------------------------------------------------------
// FEATURE B — Bulk document import (filename-matched, confirmed in a preview)
// ---------------------------------------------------------------------------

export type ImportPoDocumentsResult = {
  ok: boolean;
  error?: string;
  uploaded?: number;
  failed?: { file: string; reason: string }[];
};

// Upload a single file to its bucket + record a po_documents row. Mirrors the
// uploadDoc helper in purchase-orders/actions.ts (kept local because that one is
// not exported and takes a session client; here we use the admin client).
async function uploadOneDoc(
  admin: ReturnType<typeof createAdminClient>,
  poId: string,
  docType: string,
  file: File,
  uploadedBy: string
): Promise<string | null> {
  const bucket = BUCKET[docType];
  if (!bucket) return `Unknown document type ${docType}`;
  const path = `${poId}/${crypto.randomUUID()}-${slug(file.name)}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await admin.storage.from(bucket).upload(path, buffer, {
    contentType: file.type || "application/octet-stream",
    upsert: true,
  });
  if (upErr) return `Upload failed: ${upErr.message}`;

  const { error: docErr } = await admin.from("po_documents").insert({
    po_id: poId,
    doc_type: docType,
    file_path: `${bucket}/${path}`,
    file_name: file.name,
    uploaded_by: uploadedBy,
    approval_status: docType === "K1_FINAL" ? "PENDING" : "NOT_REQUIRED",
  });
  if (docErr) return `Record failed: ${docErr.message}`;
  return null;
}

export async function importPoDocuments(
  formData: FormData
): Promise<ImportPoDocumentsResult> {
  const profile = await getCurrentUser();
  if (!profile) return { ok: false, error: "Not signed in" };
  if (!(["SCM", "ADMIN"] as string[]).includes(profile.role)) {
    return { ok: false, error: "You don't have permission to upload documents" };
  }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const poIds = formData.getAll("po_id").map((v) => String(v));
  const docTypes = formData.getAll("doc_type").map((v) => String(v));

  if (files.length === 0) return { ok: false, error: "No files to upload" };
  if (files.length !== poIds.length || files.length !== docTypes.length) {
    return { ok: false, error: "Malformed request — file/PO/type counts differ" };
  }

  const admin = createAdminClient();

  // Validate every po_id exists before uploading anything.
  const { data: poRows, error: poErr } = await admin.from("purchase_orders").select("id");
  if (poErr) return { ok: false, error: `Could not load purchase orders: ${poErr.message}` };
  const validPoIds = new Set((poRows ?? []).map((p) => String(p.id)));

  let uploaded = 0;
  const failed: { file: string; reason: string }[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const poId = poIds[i];
    const docType = docTypes[i];

    if (!poId || !validPoIds.has(poId)) {
      failed.push({ file: file.name, reason: "no matching PO selected" });
      continue;
    }
    if (!BUCKET[docType]) {
      failed.push({ file: file.name, reason: `invalid document type: ${docType}` });
      continue;
    }

    const err = await uploadOneDoc(admin, poId, docType, file, profile.id);
    if (err) {
      failed.push({ file: file.name, reason: err });
      continue;
    }
    uploaded++;
  }

  revalidatePath("/purchase-orders");
  return { ok: true, uploaded, failed };
}

// ---------------------------------------------------------------------------
// FEATURE C — Bulk PO product-lines import (backfill in-transit incoming_stock)
// ---------------------------------------------------------------------------

export type ImportPoLinesResult = {
  ok: boolean;
  error?: string;
  posCreated?: number;
  posAttached?: number;
  linesCreated?: number;
  skipped?: { row: number; po_number: string; reason: string }[];
};

// Header aliases for the lines importer. po_number + supplier reuse the PO-import
// aliases so column detection is consistent across both importers.
const LINE_HEADER_ALIASES: Record<string, string[]> = {
  po_number: HEADER_ALIASES.po_number,
  supplier: HEADER_ALIASES.supplier,
  sku: ["sku", "product_sku", "product sku", "variant_sku", "variant sku", "item_code", "item code", "code", "product_code", "product code"],
  quantity: ["quantity", "qty", "units", "quantity_ordered", "quantity ordered"],
  eta: ["eta", "expected_date", "expected date", "expected", "arrival", "arrival_date", "arrival date"],
};
const LINE_FIELD_KEYS = Object.keys(LINE_HEADER_ALIASES);

// Locate the header row (scan first 8 rows). A row qualifies when it carries
// BOTH a po_number and an sku column.
function detectLineHeader(rows: unknown[][]): { headerIdx: number; cols: ColMap } | null {
  const norm = (v: unknown) => String(v == null ? "" : v).trim().toLowerCase().replace(/\s+/g, " ");
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const row = (rows[i] ?? []).map(norm);
    const poCol = row.findIndex((c) => LINE_HEADER_ALIASES.po_number.includes(c));
    const skuCol = row.findIndex((c) => LINE_HEADER_ALIASES.sku.includes(c));
    if (poCol < 0 || skuCol < 0) continue;
    const cols: ColMap = {};
    for (const field of LINE_FIELD_KEYS) {
      const idx = row.findIndex((c) => LINE_HEADER_ALIASES[field].includes(c));
      if (idx >= 0) cols[field] = idx;
    }
    return { headerIdx: i, cols };
  }
  return null;
}

export async function importPoLines(formData: FormData): Promise<ImportPoLinesResult> {
  const profile = await getCurrentUser();
  if (!profile) return { ok: false, error: "Not signed in" };
  if (!(["SCM", "ADMIN"] as string[]).includes(profile.role)) {
    return { ok: false, error: "You don't have permission to import PO lines" };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file uploaded" };
  }

  let wb: XLSX.WorkBook;
  try {
    const buffer = await file.arrayBuffer();
    wb = XLSX.read(buffer, { type: "array", cellDates: true });
  } catch {
    return { ok: false, error: "Could not read the uploaded file. Is it a valid .xlsx/.xls/.csv?" };
  }

  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  const detected = detectLineHeader(rows);
  if (!detected) {
    return {
      ok: false,
      error:
        'Could not find a header row with recognised "po_number" and "sku" columns. ' +
        "Start from the template (po_number, supplier, sku, quantity, eta).",
    };
  }
  const { headerIdx, cols } = detected;

  const admin = createAdminClient();

  // ---- SKU resolution map (mirrors the sales importer) ----
  // products.sku -> {productId, factor:1}; sku_mappings.variant_sku ->
  // {main_product_id, factor:units_per_variant} (does not override a direct match).
  const resolveMap = new Map<string, { productId: string; factor: number }>();
  const { data: products, error: prodErr } = await admin.from("products").select("id, sku");
  if (prodErr) return { ok: false, error: `Could not load products: ${prodErr.message}` };
  for (const p of products ?? []) {
    resolveMap.set(String(p.sku).trim().toUpperCase(), { productId: p.id, factor: 1 });
  }
  const { data: mappings, error: mapErr } = await admin
    .from("sku_mappings")
    .select("variant_sku, main_product_id, units_per_variant");
  if (mapErr) return { ok: false, error: `Could not load SKU mappings: ${mapErr.message}` };
  for (const m of mappings ?? []) {
    const key = String(m.variant_sku).trim().toUpperCase();
    if (!resolveMap.has(key)) {
      resolveMap.set(key, { productId: m.main_product_id, factor: Number(m.units_per_variant) });
    }
  }

  // ---- Supplier resolution map (mirrors importPurchaseOrders) — only needed to
  // CREATE new POs; existing POs keep their own supplier. ----
  const { data: supplierRows, error: supErr } = await admin
    .from("profiles")
    .select("id, name, company_name")
    .not("company_name", "is", null);
  if (supErr) return { ok: false, error: `Could not load suppliers: ${supErr.message}` };
  const supplierByKey = new Map<string, string[]>();
  const addSupplierKey = (key: string, id: string) => {
    const k = key.trim().toLowerCase();
    if (!k) return;
    const arr = supplierByKey.get(k) ?? [];
    if (!arr.includes(id)) arr.push(id);
    supplierByKey.set(k, arr);
  };
  for (const s of supplierRows ?? []) {
    if (s.company_name) addSupplierKey(String(s.company_name), s.id);
    if (s.name) addSupplierKey(String(s.name), s.id);
  }

  // ---- Existing POs by po_number (uppercased) → {id, targeted_eta} ----
  const { data: existingPos, error: poErr } = await admin
    .from("purchase_orders")
    .select("id, po_number, targeted_eta");
  if (poErr) return { ok: false, error: `Could not load purchase orders: ${poErr.message}` };
  const existingByNumber = new Map<string, { id: string; targeted_eta: string | null }>();
  for (const p of existingPos ?? []) {
    if (p.po_number)
      existingByNumber.set(String(p.po_number).trim().toUpperCase(), {
        id: p.id,
        targeted_eta: (p.targeted_eta as string | null) ?? null,
      });
  }

  const skipped: { row: number; po_number: string; reason: string }[] = [];

  // ---- Validate + group rows by po_number ----
  type LineEntry = { productId: string; qty: number; eta: string | null };
  type Group = { po_number: string; supplierRaw: string; firstRow: number; lines: LineEntry[] };
  const groups = new Map<string, Group>();

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const excelRow = i + 1;

    const poNumber = cell(row, cols, "po_number");
    const sku = cell(row, cols, "sku");
    const hasAnyData = row.some((c) => c != null && String(c).trim() !== "");

    if (!poNumber) {
      if (hasAnyData) skipped.push({ row: excelRow, po_number: "", reason: "po_number is blank" });
      continue;
    }
    if (!sku) {
      skipped.push({ row: excelRow, po_number: poNumber, reason: "sku is blank" });
      continue;
    }

    const hit = resolveMap.get(sku.trim().toUpperCase());
    if (!hit) {
      skipped.push({ row: excelRow, po_number: poNumber, reason: `sku not found: ${sku}` });
      continue;
    }

    const qtyRaw = parseNumber(row, cols, "quantity");
    if (qtyRaw == null || !Number.isFinite(qtyRaw) || qtyRaw <= 0) {
      skipped.push({ row: excelRow, po_number: poNumber, reason: "quantity invalid" });
      continue;
    }

    const eta = parseDate(row, cols, "eta");
    const mainQty = Math.round(qtyRaw * hit.factor);
    if (mainQty <= 0) {
      skipped.push({ row: excelRow, po_number: poNumber, reason: "quantity resolves to zero units" });
      continue;
    }

    const key = poNumber.trim().toUpperCase();
    const supplierRaw = cell(row, cols, "supplier");
    let group = groups.get(key);
    if (!group) {
      group = { po_number: poNumber, supplierRaw, firstRow: excelRow, lines: [] };
      groups.set(key, group);
    } else if (!group.supplierRaw && supplierRaw) {
      group.supplierRaw = supplierRaw; // first non-blank supplier wins
    }
    group.lines.push({ productId: hit.productId, qty: mainQty, eta });
  }

  // ---- Materialise each group → incoming_stock (delete-then-insert per PO) ----
  let posCreated = 0;
  let posAttached = 0;
  let linesCreated = 0;

  for (const [key, group] of groups) {
    let poId: string;
    let poTargetedEta: string | null;

    const existing = existingByNumber.get(key);
    if (existing) {
      poId = existing.id;
      poTargetedEta = existing.targeted_eta;
      posAttached++;
    } else {
      // New PO — a supplier is mandatory (supplier_id is NOT NULL).
      const supplierRaw = group.supplierRaw.trim();
      if (!supplierRaw) {
        skipped.push({
          row: group.firstRow,
          po_number: group.po_number,
          reason: "PO not found — provide a supplier to create it (or import the PO header first)",
        });
        continue;
      }
      const matches = supplierByKey.get(supplierRaw.toLowerCase());
      if (!matches || matches.length === 0) {
        skipped.push({
          row: group.firstRow,
          po_number: group.po_number,
          reason: "PO not found — provide a supplier to create it (or import the PO header first)",
        });
        continue;
      }
      if (matches.length > 1) {
        skipped.push({
          row: group.firstRow,
          po_number: group.po_number,
          reason: `supplier not unique: ${supplierRaw}`,
        });
        continue;
      }

      // targeted_eta = earliest ETA among the group's lines (ISO strings sort lexically).
      const etas = group.lines.map((l) => l.eta).filter((e): e is string => !!e).sort();
      const minEta = etas.length > 0 ? etas[0] : null;

      const { data: inserted, error: insPoErr } = await admin
        .from("purchase_orders")
        .insert({
          po_number: group.po_number,
          supplier_id: matches[0],
          status: "SHIPPED",
          targeted_eta: minEta,
          total_amount: 0,
          proposal_source: "MANUAL_SCM",
          proposed_by: profile.id,
        })
        .select("id, targeted_eta")
        .single();
      if (insPoErr) {
        skipped.push({ row: group.firstRow, po_number: group.po_number, reason: insPoErr.message });
        continue;
      }
      poId = inserted.id;
      poTargetedEta = (inserted.targeted_eta as string | null) ?? minEta;
      posCreated++;
      // Register so later duplicate groups (shouldn't happen — keyed) still route.
      existingByNumber.set(key, { id: poId, targeted_eta: poTargetedEta });
    }

    // Idempotent: clear any previously captured lines for this PO first.
    const { error: delErr } = await admin.from("incoming_stock").delete().eq("po_id", poId);
    if (delErr) {
      skipped.push({ row: group.firstRow, po_number: group.po_number, reason: `reset failed: ${delErr.message}` });
      continue;
    }

    const inserts = group.lines.map((line) => ({
      po_id: poId,
      product_id: line.productId,
      quantity: line.qty,
      expected_date: line.eta || poTargetedEta || null,
      status: "EXPECTED",
      created_by: profile.id,
      notes: "bulk PO lines import",
    }));
    const { error: insErr } = await admin.from("incoming_stock").insert(inserts);
    if (insErr) {
      skipped.push({ row: group.firstRow, po_number: group.po_number, reason: `lines insert failed: ${insErr.message}` });
      continue;
    }
    linesCreated += inserts.length;

    // Keep the PO value in sync with its freshly-imported lines × supplier cost.
    await recomputePoAmount(admin, poId);
  }

  revalidatePath("/purchase-orders");
  revalidatePath("/dashboard");
  return { ok: true, posCreated, posAttached, linesCreated, skipped };
}
