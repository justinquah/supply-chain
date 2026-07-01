"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PO_DRAFT_CREATORS, canActOnState } from "@/lib/po-workflow";

// doc_type -> storage bucket
const BUCKET: Record<string, string> = {
  PO_PDF: "po-pdfs",
  SUPPLIER_INVOICE: "invoices",
  BL: "shipping-docs",
  PACKING_LIST: "shipping-docs",
  K1_DRAFT: "shipping-docs",
  K1_FINAL: "shipping-docs",
  LOGISTICS_INVOICE: "invoices",
};

function slug(s: string) {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

type ActionResult = { ok: boolean; error?: string; uploaded?: number };

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Upload a single file to its bucket and record a po_documents row. Returns an
// error string on failure, or null on success.
async function uploadDoc(
  supabase: Awaited<ReturnType<typeof createClient>>,
  poId: string,
  docType: string,
  file: File,
  uploadedBy: string
): Promise<string | null> {
  const bucket = BUCKET[docType];
  if (!bucket) return `Unknown document type ${docType}`;
  const path = `${poId}/${docType}/${Date.now()}_${slug(file.name)}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await supabase.storage.from(bucket).upload(path, buffer, {
    contentType: file.type || "application/octet-stream",
    upsert: true,
  });
  if (upErr) return `Upload failed (${docType}): ${upErr.message}`;

  const { error: docErr } = await supabase.from("po_documents").insert({
    po_id: poId,
    doc_type: docType,
    file_path: `${bucket}/${path}`,
    file_name: file.name,
    uploaded_by: uploadedBy,
    approval_status: docType === "K1_FINAL" ? "PENDING" : "NOT_REQUIRED",
  });
  if (docErr) return `Record failed (${docType}): ${docErr.message}`;
  return null;
}

function isFile(v: FormDataEntryValue | null): v is File {
  return !!v && typeof v !== "string" && (v as File).size > 0;
}

// Parse repeatable "Shipping lines" rows (product_id[] + quantity[]) submitted
// by the SHIPPED-stage form. Rows with no product selected or a non-positive
// quantity are dropped silently — shipping lines are optional (SPEC: do not
// hard-block markShipped on zero lines).
function parseShippingLines(formData: FormData): { productId: string; quantity: number }[] {
  const productIds = formData.getAll("line_product_id").map((v) => String(v).trim());
  const quantities = formData.getAll("line_quantity").map((v) => Number(v));
  const lines: { productId: string; quantity: number }[] = [];
  for (let i = 0; i < productIds.length; i++) {
    const productId = productIds[i];
    const quantity = quantities[i];
    if (!productId) continue;
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    lines.push({ productId, quantity: Math.trunc(quantity) });
  }
  return lines;
}

// Fetch the PO's current status (used to enforce the transition is legal).
async function getPoStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  poId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("purchase_orders")
    .select("status")
    .eq("id", poId)
    .maybeSingle();
  return data?.status ?? null;
}

// Generate short-lived signed URLs for a PO's documents (private buckets).
export async function getDocUrl(filePath: string): Promise<string | null> {
  const supabase = await createClient();
  const slashIdx = filePath.indexOf("/");
  const bucket = filePath.slice(0, slashIdx);
  const path = filePath.slice(slashIdx + 1);
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

// ---------------------------------------------------------------------------
// (create) — SCM / ADMIN draft a PO
// ---------------------------------------------------------------------------
export async function savePurchaseOrder(formData: FormData): Promise<ActionResult> {
  const profile = await getCurrentUser();
  if (!profile) return { ok: false, error: "Not signed in" };
  if (!PO_DRAFT_CREATORS.includes(profile.role as never))
    return { ok: false, error: "Only SCM or Admin can draft a PO" };

  const supabase = await createClient();

  const poNumber = String(formData.get("po_number") || "").trim();
  const supplierId = String(formData.get("supplier_id") || "").trim() || null;
  const productGroup = String(formData.get("product_group") || "").trim() || null;
  const expectedAmount = formData.get("expected_invoice_amount")
    ? Number(formData.get("expected_invoice_amount"))
    : null;
  const invoiceCurrency = String(formData.get("invoice_currency") || "MYR").trim() || "MYR";
  const depositPercent = formData.get("deposit_percent")
    ? Number(formData.get("deposit_percent"))
    : null;
  const paymentTerms = String(formData.get("payment_terms") || "").trim() || null;
  const depositDueDate = String(formData.get("deposit_due_date") || "").trim() || null;
  const balanceDueDate = String(formData.get("balance_due_date") || "").trim() || null;
  const notes = String(formData.get("notes") || "").trim() || null;
  const editingId = String(formData.get("po_id") || "").trim() || null;

  // supplier_id is NOT NULL in the schema.
  if (!supplierId) return { ok: false, error: "Supplier is required" };
  if (depositPercent != null && (depositPercent < 0 || depositPercent > 100))
    return { ok: false, error: "Deposit % must be between 0 and 100" };

  const fields = {
    po_number: poNumber || null,
    supplier_id: supplierId,
    product_group: productGroup,
    expected_invoice_amount: expectedAmount,
    invoice_currency: invoiceCurrency,
    deposit_percent: depositPercent,
    payment_terms: paymentTerms,
    deposit_due_date: depositDueDate,
    balance_due_date: balanceDueDate,
    notes,
  };

  if (editingId) {
    // Editing an existing draft — only allowed while still DRAFT.
    const status = await getPoStatus(supabase, editingId);
    if (status && status !== "DRAFT")
      return { ok: false, error: "PO has advanced past draft and can no longer be edited here" };
    const { error } = await supabase
      .from("purchase_orders")
      .update(fields)
      .eq("id", editingId);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase.from("purchase_orders").insert({
      ...fields,
      status: "DRAFT" as const,
      proposal_source: "MANUAL_SCM" as const,
      proposed_by: profile.id,
    });
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/purchase-orders");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// DRAFT → PO_APPROVED — ACCOUNTS / ADMIN upload signed PO PDF, set po_number + targeted_eta
// ---------------------------------------------------------------------------
export async function approvePO(formData: FormData): Promise<ActionResult> {
  const profile = await getCurrentUser();
  if (!profile) return { ok: false, error: "Not signed in" };
  const supabase = await createClient();

  const poId = String(formData.get("po_id") || "").trim();
  if (!poId) return { ok: false, error: "Missing PO" };

  const status = await getPoStatus(supabase, poId);
  if (status !== "DRAFT")
    return { ok: false, error: `This action is only valid from Draft (current: ${status})` };
  if (!canActOnState(profile.role, "DRAFT"))
    return { ok: false, error: "Only Accounts or Admin can approve a PO" };

  const poNumber = String(formData.get("po_number") || "").trim();
  const targetedEta = String(formData.get("targeted_eta") || "").trim() || null;
  const file = formData.get("file_po");

  if (!poNumber) return { ok: false, error: "PO number is required" };
  if (!isFile(file)) return { ok: false, error: "Signed PO PDF is required" };

  const upErr = await uploadDoc(supabase, poId, "PO_PDF", file, profile.id);
  if (upErr) return { ok: false, error: upErr };

  const { error } = await supabase
    .from("purchase_orders")
    .update({
      po_number: poNumber,
      targeted_eta: targetedEta,
      status: "PO_APPROVED",
      approved_by: profile.id,
      approved_at: new Date().toISOString(),
    })
    .eq("id", poId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/purchase-orders");
  revalidatePath(`/purchase-orders/${poId}`);
  return { ok: true, uploaded: 1 };
}

// ---------------------------------------------------------------------------
// PO_APPROVED → INVOICE_RECEIVED — SCM / ADMIN upload supplier invoice + key amount/number/date
// ---------------------------------------------------------------------------
export async function recordInvoice(formData: FormData): Promise<ActionResult> {
  const profile = await getCurrentUser();
  if (!profile) return { ok: false, error: "Not signed in" };
  const supabase = await createClient();

  const poId = String(formData.get("po_id") || "").trim();
  if (!poId) return { ok: false, error: "Missing PO" };

  const status = await getPoStatus(supabase, poId);
  if (status !== "PO_APPROVED")
    return { ok: false, error: `This action is only valid from PO Approved (current: ${status})` };
  if (!canActOnState(profile.role, "PO_APPROVED"))
    return { ok: false, error: "Only SCM or Admin can record the supplier invoice" };

  const invoiceNumber = String(formData.get("invoice_number") || "").trim();
  const invoiceAmount = formData.get("invoice_amount")
    ? Number(formData.get("invoice_amount"))
    : null;
  const invoiceDate = String(formData.get("invoice_date") || "").trim() || null;
  const paymentTerms = String(formData.get("payment_terms") || "").trim() || null;
  const file = formData.get("file_invoice");

  if (!invoiceNumber) return { ok: false, error: "Invoice number is required" };
  if (invoiceAmount == null || Number.isNaN(invoiceAmount))
    return { ok: false, error: "Invoice amount is required" };
  if (!isFile(file)) return { ok: false, error: "Supplier invoice file is required" };

  const upErr = await uploadDoc(supabase, poId, "SUPPLIER_INVOICE", file, profile.id);
  if (upErr) return { ok: false, error: upErr };

  const update: Record<string, unknown> = {
    invoice_number: invoiceNumber,
    invoice_amount: invoiceAmount,
    invoice_date: invoiceDate,
    status: "INVOICE_RECEIVED",
  };
  if (paymentTerms) update.payment_terms = paymentTerms;

  const { error } = await supabase.from("purchase_orders").update(update).eq("id", poId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/purchase-orders");
  revalidatePath(`/purchase-orders/${poId}`);
  return { ok: true, uploaded: 1 };
}

// ---------------------------------------------------------------------------
// INVOICE_RECEIVED → SHIPPED — LOGISTICS / ADMIN upload BL + K1_FINAL, set actual_eta
// ---------------------------------------------------------------------------
export async function markShipped(formData: FormData): Promise<ActionResult> {
  const profile = await getCurrentUser();
  if (!profile) return { ok: false, error: "Not signed in" };
  const supabase = await createClient();

  const poId = String(formData.get("po_id") || "").trim();
  if (!poId) return { ok: false, error: "Missing PO" };

  const status = await getPoStatus(supabase, poId);
  if (status !== "INVOICE_RECEIVED")
    return { ok: false, error: `This action is only valid from Invoice Received (current: ${status})` };
  if (!canActOnState(profile.role, "INVOICE_RECEIVED"))
    return { ok: false, error: "Only Logistics or Admin can mark a PO shipped" };

  const actualEta = String(formData.get("actual_eta") || "").trim() || null;
  const fileBl = formData.get("file_bl");
  const fileK1 = formData.get("file_k1");

  // BL + K1_FINAL are mandatory to ship. Allow either to already exist on the PO.
  const { data: existingDocs } = await supabase
    .from("po_documents")
    .select("doc_type")
    .eq("po_id", poId);
  const have = new Set((existingDocs ?? []).map((d) => d.doc_type));

  if (!isFile(fileBl) && !have.has("BL"))
    return { ok: false, error: "Bill of Lading (BL) is required to ship" };
  if (!isFile(fileK1) && !have.has("K1_FINAL"))
    return { ok: false, error: "K1 (final) is required to ship" };

  if (isFile(fileBl)) {
    const e = await uploadDoc(supabase, poId, "BL", fileBl, profile.id);
    if (e) return { ok: false, error: e };
  }
  if (isFile(fileK1)) {
    const e = await uploadDoc(supabase, poId, "K1_FINAL", fileK1, profile.id);
    if (e) return { ok: false, error: e };
  }

  // Fetch po_number + targeted_eta up front — needed for the incoming_stock
  // expected_date fallback and notes, and read before the status update below.
  const { data: poRow } = await supabase
    .from("purchase_orders")
    .select("po_number, targeted_eta")
    .eq("id", poId)
    .maybeSingle();

  const { error } = await supabase
    .from("purchase_orders")
    .update({
      actual_eta: actualEta,
      status: "SHIPPED",
      issued_by: profile.id,
      issued_at: new Date().toISOString(),
    })
    .eq("id", poId);
  if (error) return { ok: false, error: error.message };

  // Shipping lines -> incoming_stock (dashboard's "Incoming" reads this table).
  // incoming_stock RLS write is SCM/ADMIN only, so LOGISTICS writes go through
  // the service-role client, gated by the canActOnState check above.
  const lines = parseShippingLines(formData);
  const expectedDate = actualEta || poRow?.targeted_eta || null;
  if (lines.length > 0 && expectedDate) {
    const admin = createAdminClient();
    // Idempotent re-ship: clear any previously captured lines for this PO first.
    const { error: delErr } = await admin
      .from("incoming_stock")
      .delete()
      .eq("po_id", poId);
    if (delErr) return { ok: false, error: `Failed to reset shipping lines: ${delErr.message}` };

    const poNumber = poRow?.po_number || "";
    const { error: insErr } = await admin.from("incoming_stock").insert(
      lines.map((line) => ({
        product_id: line.productId,
        quantity: line.quantity,
        expected_date: expectedDate,
        po_id: poId,
        status: "EXPECTED",
        created_by: profile.id,
        notes: poNumber ? `PO ${poNumber}` : null,
      }))
    );
    if (insErr) return { ok: false, error: `Failed to record shipping lines: ${insErr.message}` };
  }

  revalidatePath("/purchase-orders");
  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// SHIPPED → RECEIVED — WAREHOUSE / ADMIN. GATED: BL + K1_FINAL present AND balance_remaining = 0.
// ---------------------------------------------------------------------------
export async function markReceived(formData: FormData): Promise<ActionResult> {
  const profile = await getCurrentUser();
  if (!profile) return { ok: false, error: "Not signed in" };
  const supabase = await createClient();

  const poId = String(formData.get("po_id") || "").trim();
  if (!poId) return { ok: false, error: "Missing PO" };

  const status = await getPoStatus(supabase, poId);
  if (status !== "SHIPPED")
    return { ok: false, error: `This action is only valid from Shipped (current: ${status})` };
  if (!canActOnState(profile.role, "SHIPPED"))
    return { ok: false, error: "Only Warehouse or Admin can mark goods received" };

  // --- HARD GATE 1: required documents ---
  const { data: docs } = await supabase
    .from("po_documents")
    .select("doc_type")
    .eq("po_id", poId);
  const have = new Set((docs ?? []).map((d) => d.doc_type));
  const missing: string[] = [];
  if (!have.has("BL")) missing.push("Bill of Lading (BL)");
  if (!have.has("K1_FINAL")) missing.push("K1 (final)");
  if (missing.length)
    return { ok: false, error: `Cannot receive — missing: ${missing.join(", ")}` };

  // --- HARD GATE 2: balance fully paid ---
  const { data: bal } = await supabase
    .from("v_po_balance")
    .select("balance_remaining")
    .eq("po_id", poId)
    .maybeSingle();
  const remaining = Number(bal?.balance_remaining ?? 0);
  if (remaining !== 0) {
    return {
      ok: false,
      error: `Cannot receive — outstanding balance of ${remaining.toLocaleString("en-MY", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} must be fully paid by Finance first`,
    };
  }

  const remark = String(formData.get("remark") || "").trim();
  const proof = formData.get("file_proof");
  const receivedQtyRaw = String(formData.get("received_qty") || "").trim();
  const damagedQtyRaw = String(formData.get("damaged_qty") || "").trim();
  const containerArrivedAt = String(formData.get("container_arrived_at") || "").trim() || null;
  const unloadCompletedAtRaw = String(formData.get("unload_completed_at") || "").trim();

  const receivedQty = receivedQtyRaw ? Number(receivedQtyRaw) : null;
  const damagedQty = damagedQtyRaw ? Number(damagedQtyRaw) : null;
  if (receivedQty != null && (Number.isNaN(receivedQty) || receivedQty < 0))
    return { ok: false, error: "Received qty must be a non-negative number" };
  if (damagedQty != null && (Number.isNaN(damagedQty) || damagedQty < 0))
    return { ok: false, error: "Damaged qty must be a non-negative number" };

  // WHS-04: unload_completed_at defaults to now() if not supplied by the actor.
  const unloadCompletedAt = unloadCompletedAtRaw
    ? new Date(unloadCompletedAtRaw).toISOString()
    : new Date().toISOString();

  const update: Record<string, unknown> = {
    status: "RECEIVED",
    received_qty: receivedQty,
    damaged_qty: damagedQty,
    receipt_remark: remark || null,
    container_arrived_at: containerArrivedAt,
    unload_completed_at: unloadCompletedAt,
  };

  // Optional proof photo → receipt-photos bucket, path recorded on the PO
  // (receipt_proof_path — WHS-02). Private bucket; reuse getDocUrl-style signed URLs.
  if (isFile(proof)) {
    const path = `${poId}/receipt/${Date.now()}_${slug(proof.name)}`;
    const buffer = Buffer.from(await proof.arrayBuffer());
    const { error: upErr } = await supabase.storage
      .from("receipt-photos")
      .upload(path, buffer, {
        contentType: proof.type || "application/octet-stream",
        upsert: true,
      });
    if (upErr) return { ok: false, error: `Proof photo upload failed: ${upErr.message}` };
    update.receipt_proof_path = `receipt-photos/${path}`;
  }

  const { error } = await supabase.from("purchase_orders").update(update).eq("id", poId);
  if (error) return { ok: false, error: error.message };

  // Clear this PO's incoming_stock rows so they drop off the dashboard's
  // "Incoming" columns (which only count status='EXPECTED'). incoming_stock
  // write RLS is SCM/ADMIN only, so the WAREHOUSE write goes through the
  // service-role client, gated by the canActOnState check above.
  const admin = createAdminClient();
  const { error: arrivedErr } = await admin
    .from("incoming_stock")
    .update({ status: "ARRIVED" })
    .eq("po_id", poId)
    .eq("status", "EXPECTED");
  if (arrivedErr)
    return { ok: false, error: `Received recorded but failed to clear incoming stock: ${arrivedErr.message}` };

  revalidatePath("/purchase-orders");
  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath("/warehouse");
  revalidatePath("/dashboard");
  return { ok: true };
}
