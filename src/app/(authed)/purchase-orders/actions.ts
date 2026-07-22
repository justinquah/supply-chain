"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser, requireRole } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  PO_DRAFT_CREATORS,
  PO_WORKFLOW_STATES,
  canActOnState,
  isClearanceStatus,
} from "@/lib/po-workflow";
import {
  readRule,
  readSupplierDefaults,
  validateRuleInput,
  type PaymentRuleFields,
  type SupplierPaymentDefaults,
} from "@/lib/payment-terms";

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

// Recompute a PO's expected_invoice_amount + invoice_currency from its product
// lines × the per-(product, supplier) cost. Called at the end of every path that
// writes/edits a PO's incoming_stock lines. Uses the caller's admin
// (service-role) client so it works regardless of the actor's RLS. Leaves the
// fields untouched when there are no priced lines (never zeroes them out).
export async function recomputePoAmount(
  admin: ReturnType<typeof createAdminClient>,
  poId: string
): Promise<void> {
  // 1. The PO's supplier — costs are per (product, supplier).
  const { data: po } = await admin
    .from("purchase_orders")
    .select("supplier_id")
    .eq("id", poId)
    .maybeSingle();
  const supplierId = (po as any)?.supplier_id as string | null | undefined;
  if (!supplierId) return;

  // 2. The PO's incoming lines (quantities are stored in main units).
  const { data: lineData } = await admin
    .from("incoming_stock")
    .select("product_id, quantity")
    .eq("po_id", poId);
  const lines = (lineData ?? []) as { product_id: string; quantity: number }[];
  if (lines.length === 0) return;

  // 3. The costs for those products under this supplier.
  const productIds = [...new Set(lines.map((l) => String(l.product_id)))];
  const { data: costData } = await admin
    .from("product_suppliers")
    .select("product_id, unit_cost, cost_currency")
    .eq("supplier_id", supplierId)
    .in("product_id", productIds);
  const costByProduct = new Map<string, { unitCost: number; currency: string }>();
  for (const c of (costData ?? []) as any[]) {
    const unitCost = Number(c.unit_cost);
    if (!Number.isFinite(unitCost)) continue;
    costByProduct.set(String(c.product_id), {
      unitCost,
      currency: String(c.cost_currency),
    });
  }

  // 4. amount = Σ quantity × unit_cost (priced lines only); currency = the most
  // common cost currency among priced lines.
  let amount = 0;
  const currencyCount = new Map<string, number>();
  for (const line of lines) {
    const cost = costByProduct.get(String(line.product_id));
    if (!cost) continue;
    const qty = Number(line.quantity);
    if (!Number.isFinite(qty)) continue;
    amount += qty * cost.unitCost;
    currencyCount.set(cost.currency, (currencyCount.get(cost.currency) ?? 0) + 1);
  }
  if (amount <= 0 || currencyCount.size === 0) return;

  let currency = "MYR";
  let best = -1;
  for (const [cur, count] of currencyCount) {
    if (count > best) {
      best = count;
      currency = cur;
    }
  }

  // 5. Persist. round(amount, 2).
  await admin
    .from("purchase_orders")
    .update({
      expected_invoice_amount: Math.round(amount * 100) / 100,
      invoice_currency: currency,
    })
    .eq("id", poId);
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

// Parse the repeatable "Product lines" rows submitted by the PO create form
// (line_product_id[] + line_quantity[] + line_eta[]). Mirrors parseShippingLines
// but carries an optional per-line ETA. Rows with no product or a non-positive
// quantity are dropped silently — product lines are optional (SPEC: zero lines
// must not block PO creation).
function parseProductLines(
  formData: FormData
): { productId: string; quantity: number; unit: "units" | "cartons"; eta: string | null }[] {
  const productIds = formData.getAll("line_product_id").map((v) => String(v).trim());
  const quantities = formData.getAll("line_quantity").map((v) => Number(v));
  const units = formData.getAll("line_unit").map((v) => String(v).trim());
  const etas = formData.getAll("line_eta").map((v) => String(v).trim());
  const lines: { productId: string; quantity: number; unit: "units" | "cartons"; eta: string | null }[] = [];
  for (let i = 0; i < productIds.length; i++) {
    const productId = productIds[i];
    const quantity = quantities[i];
    if (!productId) continue;
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const rawEta = etas[i] ?? "";
    const eta = /^\d{4}-\d{2}-\d{2}$/.test(rawEta) ? rawEta : null;
    const unit = units[i] === "cartons" ? "cartons" : "units";
    lines.push({ productId, quantity: Math.round(quantity), unit, eta });
  }
  return lines;
}

// Parse the per-line receiving rows submitted by the GRN receiving form. Each
// row is keyed by its incoming_stock id (recv_line_id[]) with parallel
// recv_received[] / recv_extra[] / recv_short[] (Less) / recv_damaged[] +
// recv_remark[] (the discrepancy Reason) fields. A blank numeric cell yields
// null (left untouched); a present value is coerced to a non-negative integer
// (negatives clamp to 0). A blank reason yields null (source notes left as-is).
type ReceivingLine = {
  id: string;
  received: number | null;
  damaged: number | null;
  short: number | null;
  extra: number | null;
  remark: string | null;
};
function parseReceivingLines(formData: FormData): ReceivingLine[] {
  const ids = formData.getAll("recv_line_id").map((v) => String(v).trim());
  const received = formData.getAll("recv_received").map((v) => String(v).trim());
  const damaged = formData.getAll("recv_damaged").map((v) => String(v).trim());
  const short = formData.getAll("recv_short").map((v) => String(v).trim());
  const extra = formData.getAll("recv_extra").map((v) => String(v).trim());
  const remark = formData.getAll("recv_remark").map((v) => String(v).trim());
  const toInt = (raw: string | undefined): number | null => {
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.trunc(n));
  };
  const lines: ReceivingLine[] = [];
  for (let i = 0; i < ids.length; i++) {
    if (!ids[i]) continue;
    const reason = remark[i] ?? "";
    lines.push({
      id: ids[i],
      received: toInt(received[i]),
      damaged: toInt(damaged[i]),
      short: toInt(short[i]),
      extra: toInt(extra[i]),
      remark: reason === "" ? null : reason,
    });
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

// Direct, stage-independent document upload from the PO detail's Documents card.
// Available to the internal roles that handle PO paperwork at any workflow stage.
// Reuses the shared uploadDoc helper + a session client (storage RLS is
// authenticated) and records the po_documents row under the actor's id.
export async function uploadPoDocument(
  poId: string,
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  const profile = await requireRole("SCM", "ADMIN", "ACCOUNTS", "FINANCE", "LOGISTICS");
  if (!poId) return { ok: false, error: "Missing PO" };

  const docTypeRaw = String(formData.get("doc_type") || "PO_PDF").trim() || "PO_PDF";
  // Validate against the doc_type enum via the BUCKET map (its keys are the enum).
  const docType = BUCKET[docTypeRaw] ? docTypeRaw : null;
  if (!docType) return { ok: false, error: "Invalid document type" };

  const file = formData.get("file");
  if (!isFile(file)) return { ok: false, error: "A file is required" };

  const supabase = await createClient();
  const upErr = await uploadDoc(supabase, poId, docType, file, profile.id);
  if (upErr) return { ok: false, error: upErr };

  // Doc-driven status: the uploaded document IS the evidence of the hand-off.
  //   PO PDF            → the PO went to the supplier     → at least SENT
  //   Supplier invoice  → the invoice is in hand          → INVOICE_RECEIVED
  //   BL                → goods are loaded on the vessel  → SHIPPED
  // Forward-only: never downgrade a PO that is already further along.
  const { data: poRow } = await supabase
    .from("purchase_orders")
    .select("status")
    .eq("id", poId)
    .maybeSingle();
  const cur = String(poRow?.status ?? "");
  let target: string | null = null;
  if (docType === "PO_PDF" && cur === "DRAFT") target = "SENT";
  if (
    docType === "SUPPLIER_INVOICE" &&
    ["DRAFT", "SENT", "PO_APPROVED"].includes(cur)
  )
    target = "INVOICE_RECEIVED";
  if (
    docType === "BL" &&
    ["DRAFT", "SENT", "PO_APPROVED", "INVOICE_RECEIVED"].includes(cur)
  )
    target = "SHIPPED";

  if (target) {
    // Admin client: uploaders include ACCOUNTS/FINANCE/LOGISTICS, whose RLS may
    // not cover a purchase_orders status write. The role gate above is the boundary.
    const admin = createAdminClient();
    const { error: stErr } = await admin
      .from("purchase_orders")
      .update({ status: target })
      .eq("id", poId);
    if (!stErr) {
      await admin.from("audit_log").insert({
        actor_id: profile.id,
        entity_type: "purchase_orders",
        entity_id: poId,
        action: "PO_STATUS_CHANGED",
        old_value: { status: cur },
        new_value: { status: target, trigger: `doc_upload:${docType}` },
      });
    }
    // A failed auto-advance must not fail the upload itself — the document is
    // already stored; SCM can still set the status from the dropdown.
  }

  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath("/purchase-orders");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Manual status override — SCM / ADMIN only, audit-logged.
// ---------------------------------------------------------------------------
// The hand-off actions above each enforce a single legal transition. This is the
// escape hatch for correcting mistakes: SCM/ADMIN may set ANY of the six
// workflow statuses, forward or backward. It deliberately writes ONLY the status
// column — it does not run any stage side-effects (no document gates, no
// incoming_stock writes, no payment re-anchoring), so it cannot be used to skip
// a gate's data capture, only its position in the chain.
//
// Every change is recorded in audit_log (actor_id / entity_type / entity_id /
// action / old_value / new_value — the columns defined in migration 0001).
// audit_log has a SELECT policy only (ADMIN/SCM read); there is no INSERT policy,
// so the row is written with the service-role client. requireRole above is the
// security boundary.
export async function updatePoStatus(
  poId: string,
  status: string
): Promise<{ ok: boolean; error?: string }> {
  const profile = await requireRole("SCM", "ADMIN");
  if (!poId) return { ok: false, error: "Missing PO" };

  // Whitelist: only the six workflow labels. Anything else (including the legacy
  // po_status enum values such as PROPOSED/ISSUED/CANCELLED) is rejected.
  const next = String(status || "").trim().toUpperCase();
  if (!(PO_WORKFLOW_STATES as readonly string[]).includes(next))
    return { ok: false, error: `Invalid status: ${status}` };

  const supabase = await createClient();
  const previous = await getPoStatus(supabase, poId);
  if (previous == null) return { ok: false, error: "Purchase order not found" };
  if (previous === next) return { ok: true };

  const { error } = await supabase
    .from("purchase_orders")
    .update({ status: next })
    .eq("id", poId);
  if (error) return { ok: false, error: error.message };

  const admin = createAdminClient();

  // Keep incoming_stock in step with the status. The dashboard's "Incoming"
  // columns count status='EXPECTED' lines, and the Warehouse receive flow flips
  // them to ARRIVED — so a manual jump to RECEIVED must do the same, or the
  // units would show as arriving forever. Symmetrically, moving a RECEIVED PO
  // backwards puts its lines back in transit.
  if (next === "RECEIVED") {
    await admin
      .from("incoming_stock")
      .update({ status: "ARRIVED" })
      .eq("po_id", poId)
      .eq("status", "EXPECTED");
  } else if (previous === "RECEIVED") {
    await admin
      .from("incoming_stock")
      .update({ status: "EXPECTED" })
      .eq("po_id", poId)
      .eq("status", "ARRIVED");
  }
  const { error: auditErr } = await admin.from("audit_log").insert({
    actor_id: profile.id,
    entity_type: "purchase_orders",
    entity_id: poId,
    action: "PO_STATUS_CHANGED",
    old_value: { status: previous },
    new_value: { status: next },
  });
  // The status change already succeeded; surface a failed audit write rather
  // than silently dropping it, but do not pretend the update did not happen.
  if (auditErr) {
    revalidatePath(`/purchase-orders/${poId}`);
    revalidatePath("/purchase-orders");
    revalidatePath("/dashboard");
    return { ok: false, error: `Status changed, but the audit entry failed: ${auditErr.message}` };
  }

  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath("/purchase-orders");
  // Incoming columns on the dashboard change when lines flip EXPECTED/ARRIVED.
  revalidatePath("/dashboard");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Container number — SCM / ADMIN / LOGISTICS (Logistics own BL/clearance).
// ---------------------------------------------------------------------------
export async function updateContainerNumber(
  poId: string,
  containerNumber: string
): Promise<{ ok: boolean; error?: string }> {
  const profile = await requireRole("SCM", "ADMIN", "LOGISTICS");
  if (!poId) return { ok: false, error: "Missing PO" };

  // Free text (some POs share/split containers) — trim; empty clears it.
  const value = String(containerNumber ?? "").trim() || null;

  const supabase = await createClient();
  const { data: poRow } = await supabase
    .from("purchase_orders")
    .select("container_number")
    .eq("id", poId)
    .maybeSingle();
  if (!poRow) return { ok: false, error: "Purchase order not found" };
  const previous = (poRow.container_number as string | null) ?? null;
  if (previous === value) return { ok: true };

  const { error } = await supabase
    .from("purchase_orders")
    .update({ container_number: value })
    .eq("id", poId);
  if (error) return { ok: false, error: error.message };

  const admin = createAdminClient();
  await admin.from("audit_log").insert({
    actor_id: profile.id,
    entity_type: "purchase_orders",
    entity_id: poId,
    action: "PO_CONTAINER_CHANGED",
    old_value: { container_number: previous },
    new_value: { container_number: value },
  });

  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath("/purchase-orders");
  return { ok: true };
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
  const paymentTerms = String(formData.get("payment_terms") || "").trim() || null;
  const notes = String(formData.get("notes") || "").trim() || null;
  const editingId = String(formData.get("po_id") || "").trim() || null;

  // supplier_id is NOT NULL in the schema.
  if (!supplierId) return { ok: false, error: "Supplier is required" };

  // --- Structured payment rule -------------------------------------------
  // Only the RULE fields are ever written. deposit_due_date / balance_due_date
  // are derived by the DB trigger trg_po_payment_terms and must not be written
  // from app code.
  const blankToNull = (name: string): string | null => {
    const v = String(formData.get(name) ?? "").trim();
    return v === "" ? null : v;
  };
  const validated = validateRuleInput({
    depositPercent: blankToNull("deposit_percent"),
    depositLeadMonths: blankToNull("deposit_lead_months"),
    balanceDaysAfterEta: blankToNull("balance_days_after_eta"),
  });
  if (!validated.ok) return { ok: false, error: validated.error };
  let rule = validated.value;

  const admin = createAdminClient();

  // Fields the user left blank fall back to (1) the PO's current value when
  // editing an existing draft, then (2) the supplier's default rule. A value
  // the user actually typed — including 0 — is never overwritten.
  if (
    rule.depositPercent == null ||
    rule.depositLeadMonths == null ||
    rule.balanceDaysAfterEta == null
  ) {
    if (editingId) {
      const { data: existing } = await admin
        .from("purchase_orders")
        .select("deposit_percent, deposit_lead_months, balance_days_after_eta")
        .eq("id", editingId)
        .maybeSingle();
      const current = readRule(existing as PaymentRuleFields | null);
      rule = {
        depositPercent: rule.depositPercent ?? current.depositPercent,
        depositLeadMonths: rule.depositLeadMonths ?? current.depositLeadMonths,
        balanceDaysAfterEta: rule.balanceDaysAfterEta ?? current.balanceDaysAfterEta,
      };
    }

    if (
      rule.depositPercent == null ||
      rule.depositLeadMonths == null ||
      rule.balanceDaysAfterEta == null
    ) {
      const { data: supplierRow } = await admin
        .from("profiles")
        .select(
          "supplier_deposit_percent, supplier_deposit_lead_months, supplier_balance_days_after_eta"
        )
        .eq("id", supplierId)
        .maybeSingle();
      const defaults = readSupplierDefaults(supplierRow as SupplierPaymentDefaults | null);
      rule = {
        depositPercent: rule.depositPercent ?? defaults.depositPercent,
        depositLeadMonths: rule.depositLeadMonths ?? defaults.depositLeadMonths,
        balanceDaysAfterEta: rule.balanceDaysAfterEta ?? defaults.balanceDaysAfterEta,
      };
    }
  }

  const fields = {
    po_number: poNumber || null,
    supplier_id: supplierId,
    product_group: productGroup,
    expected_invoice_amount: expectedAmount,
    invoice_currency: invoiceCurrency,
    deposit_percent: rule.depositPercent,
    deposit_lead_months: rule.depositLeadMonths,
    balance_days_after_eta: rule.balanceDaysAfterEta,
    payment_terms: paymentTerms,
    notes,
  };

  let poId: string;
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
    poId = editingId;
  } else {
    const { data: inserted, error } = await supabase
      .from("purchase_orders")
      .insert({
        ...fields,
        status: "DRAFT" as const,
        proposal_source: "MANUAL_SCM" as const,
        proposed_by: profile.id,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    poId = inserted.id;
  }

  // Product lines → incoming_stock (dashboard's "Incoming / in-transit" reads
  // this table). incoming_stock write RLS is SCM/ADMIN — PO_DRAFT_CREATORS is
  // SCM/ADMIN (gated above), but we route through the service-role client to
  // mirror markShipped's idempotent delete-then-insert pattern. Lines are
  // OPTIONAL: zero valid lines simply clears any previously captured lines and
  // never blocks the save.
  const targetedEta = String(formData.get("targeted_eta") || "").trim() || null;
  const lines = parseProductLines(formData);
  const { error: delErr } = await admin.from("incoming_stock").delete().eq("po_id", poId);
  if (delErr) return { ok: false, error: `Failed to reset product lines: ${delErr.message}` };
  if (lines.length > 0) {
    // A line ordered in "cartons" is converted to main units via the product's
    // units_per_carton — incoming_stock.quantity is always stored in main units
    // so the dashboard's incoming/in-transit math is unchanged.
    const cartonProductIds = [
      ...new Set(lines.filter((l) => l.unit === "cartons").map((l) => l.productId)),
    ];
    const upcById = new Map<string, number>();
    if (cartonProductIds.length > 0) {
      const { data: prodRows, error: upcErr } = await admin
        .from("products")
        .select("id, units_per_carton")
        .in("id", cartonProductIds);
      if (upcErr) return { ok: false, error: `Failed to load pack sizes: ${upcErr.message}` };
      for (const r of prodRows ?? []) {
        const upc = Number((r as any).units_per_carton);
        upcById.set((r as any).id, Number.isFinite(upc) && upc > 0 ? upc : 1);
      }
    }

    const { error: insErr } = await admin.from("incoming_stock").insert(
      lines.map((line) => {
        const upc = line.unit === "cartons" ? upcById.get(line.productId) ?? 1 : 1;
        return {
          po_id: poId,
          product_id: line.productId,
          quantity: line.quantity * upc,
          expected_date: line.eta || targetedEta || null,
          status: "EXPECTED",
          created_by: profile.id,
          notes: poNumber ? `PO ${poNumber}` : "PO",
        };
      })
    );
    if (insErr) return { ok: false, error: `Failed to record product lines: ${insErr.message}` };
  }

  // Keep the PO value in sync with its lines × per-supplier cost.
  await recomputePoAmount(admin, poId);

  revalidatePath("/purchase-orders");
  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Payment rule — SCM / ADMIN edit a PO's deposit + balance terms
// ---------------------------------------------------------------------------
// Writes ONLY the three RULE columns. deposit_due_date / balance_due_date are
// recomputed by the DB trigger trg_po_payment_terms from the effective ETA
// (COALESCE(actual_eta, logistics_eta, supplier_eta, targeted_eta)) — the app
// never writes them. Callers re-read the PO to see the resulting dates.
//
// Blank/null = "no rule" (the existing manually-entered dates are left alone);
// 0% deposit = "no deposit payable" (the trigger clears deposit_due_date).
//
// Gated to SCM/ADMIN — matching the who-edits-what matrix already used for the
// SCM-owned fields on the PO detail page. Routed through the admin
// (service-role) client because purchase_orders RLS is row-level and cannot
// restrict columns; this literal column list is the boundary.
export async function updatePoPaymentRule(
  poId: string,
  depositPercent: number | null,
  depositLeadMonths: number | null,
  balanceDaysAfterEta: number | null
): Promise<ActionResult> {
  await requireRole("SCM", "ADMIN");
  if (!poId) return { ok: false, error: "Missing PO" };

  const validated = validateRuleInput({
    depositPercent,
    depositLeadMonths,
    balanceDaysAfterEta,
  });
  if (!validated.ok) return { ok: false, error: validated.error };

  const admin = createAdminClient();
  const { error } = await admin
    .from("purchase_orders")
    .update({
      deposit_percent: validated.value.depositPercent,
      deposit_lead_months: validated.value.depositLeadMonths,
      balance_days_after_eta: validated.value.balanceDaysAfterEta,
    })
    .eq("id", poId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath("/purchase-orders");
  revalidatePath("/finance");
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
  // Non-breaking: markShipped may optionally carry ETD / logistics ETA.
  const etd = String(formData.get("etd") || "").trim() || null;
  const logisticsEta = String(formData.get("logistics_eta") || "").trim() || null;
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
  // expected_date fallback and notes.
  const { data: poRow } = await supabase
    .from("purchase_orders")
    .select("po_number, targeted_eta")
    .eq("id", poId)
    .maybeSingle();

  // Writing actual_eta / logistics_eta re-fires trg_po_payment_terms, which
  // recomputes deposit_due_date + balance_due_date when a rule is set. We must
  // NOT write those date columns ourselves.
  const update: Record<string, unknown> = {
    actual_eta: actualEta,
    status: "SHIPPED",
    issued_by: profile.id,
    issued_at: new Date().toISOString(),
  };
  if (etd) update.etd = etd;
  if (logisticsEta) update.logistics_eta = logisticsEta;

  const { error } = await supabase
    .from("purchase_orders")
    .update(update)
    .eq("id", poId);
  if (error) return { ok: false, error: error.message };

  // Shipping lines -> incoming_stock (dashboard's "Incoming" reads this table).
  // incoming_stock RLS write is SCM/ADMIN only, so LOGISTICS writes go through
  // the service-role client, gated by the canActOnState check above.
  const lines = parseShippingLines(formData);
  const expectedDate = actualEta || poRow?.targeted_eta || null;
  const admin = createAdminClient();
  if (lines.length > 0 && expectedDate) {
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

  // Keep the PO value in sync with its (possibly updated) shipping lines.
  await recomputePoAmount(admin, poId);

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
  const containerArrivedAt = String(formData.get("container_arrived_at") || "").trim() || null;
  const unloadCompletedAtRaw = String(formData.get("unload_completed_at") || "").trim();

  // WHS-04: unload_completed_at defaults to now() if not supplied by the actor.
  const unloadCompletedAt = unloadCompletedAtRaw
    ? new Date(unloadCompletedAtRaw).toISOString()
    : new Date().toISOString();

  // --- Per-line receiving ---
  // The receiving form carries one row per incoming_stock line, keyed by the
  // line's id: recv_line_id[] + recv_received[]/recv_damaged[]/recv_short[]/recv_extra[].
  const admin = createAdminClient();
  const { data: lineRows, error: linesErr } = await admin
    .from("incoming_stock")
    .select("id")
    .eq("po_id", poId);
  if (linesErr)
    return { ok: false, error: `Failed to load incoming lines: ${linesErr.message}` };
  const validLineIds = new Set((lineRows ?? []).map((r) => String(r.id)));

  const receivedByLine = parseReceivingLines(formData);
  const nowIso = new Date().toISOString();

  // Aggregate received/damaged for the PO-level summary fields (kept for the
  // existing Goods receipt card). Sum across the submitted lines.
  let aggReceived = 0;
  let aggDamaged = 0;
  let sawAnyQty = false;

  for (const line of receivedByLine) {
    if (!validLineIds.has(line.id)) continue; // ignore lines not on this PO
    aggReceived += line.received ?? 0;
    aggDamaged += line.damaged ?? 0;
    if (
      line.received != null ||
      line.damaged != null ||
      line.short != null ||
      line.extra != null
    )
      sawAnyQty = true;

    // Per-line write. qty_short = Less, qty_extra = Extra, qty_damaged = Damaged.
    // The discrepancy reason overwrites notes only when supplied — a blank reason
    // leaves the existing source label (e.g. "PO 123") untouched.
    const lineUpdate: Record<string, unknown> = {
      qty_received: line.received,
      qty_damaged: line.damaged,
      qty_short: line.short,
      qty_extra: line.extra,
      received_by: profile.id,
      received_at: nowIso,
      status: "ARRIVED",
    };
    if (line.remark) lineUpdate.notes = line.remark;

    const { error: updLineErr } = await admin
      .from("incoming_stock")
      .update(lineUpdate)
      .eq("id", line.id)
      .eq("po_id", poId);
    if (updLineErr)
      return { ok: false, error: `Failed to record receiving line: ${updLineErr.message}` };
  }

  // Any incoming lines the form did not itemise still need to drop off the
  // dashboard's "Incoming" columns (which only count status='EXPECTED').
  const { error: arrivedErr } = await admin
    .from("incoming_stock")
    .update({ status: "ARRIVED" })
    .eq("po_id", poId)
    .eq("status", "EXPECTED");
  if (arrivedErr)
    return { ok: false, error: `Received recorded but failed to clear incoming stock: ${arrivedErr.message}` };

  const update: Record<string, unknown> = {
    status: "RECEIVED",
    clearance_status: "RECEIVED",
    received_qty: sawAnyQty ? aggReceived : null,
    damaged_qty: sawAnyQty ? aggDamaged : null,
    receipt_remark: remark || null,
    unload_completed_at: unloadCompletedAt,
  };
  if (containerArrivedAt) update.container_arrived_at = containerArrivedAt;

  // Photos: each uploaded receipt photo → receipt-photos bucket + a
  // po_receipt_photos row. Private bucket; signed URLs minted on read.
  // po_receipt_photos write RLS is SCM/ADMIN/WAREHOUSE — but we route through
  // the admin client for consistency with the incoming_stock writes above
  // (already gated by canActOnState). First uploaded photo also back-fills the
  // legacy receipt_proof_path so the existing Goods receipt card keeps working.
  const photos = formData.getAll("file_photos").filter(isFile) as File[];
  let firstPhotoPath: string | null = null;
  for (const photo of photos) {
    const safeName = slug(photo.name);
    const objectPath = `${poId}/${crypto.randomUUID()}-${safeName}`;
    const buffer = Buffer.from(await photo.arrayBuffer());
    const { error: upErr } = await supabase.storage
      .from("receipt-photos")
      .upload(objectPath, buffer, {
        contentType: photo.type || "application/octet-stream",
        upsert: true,
      });
    if (upErr) return { ok: false, error: `Receipt photo upload failed: ${upErr.message}` };
    const filePath = `receipt-photos/${objectPath}`;
    if (!firstPhotoPath) firstPhotoPath = filePath;
    const { error: photoErr } = await admin.from("po_receipt_photos").insert({
      po_id: poId,
      file_path: filePath,
      caption: remark || null,
      uploaded_by: profile.id,
      uploaded_at: nowIso,
    });
    if (photoErr) return { ok: false, error: `Failed to record receipt photo: ${photoErr.message}` };
  }
  if (firstPhotoPath) update.receipt_proof_path = firstPhotoPath;

  const { error } = await supabase.from("purchase_orders").update(update).eq("id", poId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/purchase-orders");
  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath("/warehouse");
  revalidatePath("/dashboard");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// ETD / ETA chain, clearance, delay — inline field updates (not stage
// transitions). Each action: (1) authenticates, (2) enforces the who-edits-what
// matrix app-side, (3) validates, (4) updates ONLY its whitelisted column(s),
// (5) revalidates the PO detail + dashboard. The column whitelist is the
// security boundary — RLS on purchase_orders is row-level and cannot restrict
// which columns a role may write. Internal roles use the session client (their
// UPDATE passes RLS); we still hard-gate the role in code.
// ---------------------------------------------------------------------------

// Validate a plain YYYY-MM-DD date string (or empty -> null). Rejects anything
// else so we never persist malformed values into a DATE column.
function parseDateInput(raw: FormDataEntryValue | null): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

// NOTE on payment due dates: deposit_due_date / balance_due_date are DERIVED
// columns owned by the DB trigger trg_po_payment_terms. Every ETA write below
// re-fires that trigger, which re-anchors the due dates from the effective ETA
// whenever the PO carries a rule (deposit_lead_months / balance_days_after_eta).
// App code writes the ETA only — never the derived dates.

function revalidatePo(poId: string) {
  revalidatePath("/purchase-orders");
  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath("/dashboard");
}

// updateEtd — internal callers only (SCM/ADMIN). Suppliers set ETD via the
// supplier portal action (see supplier/actions.ts updateSupplierDates).
export async function updateEtd(poId: string, etd: string | null): Promise<ActionResult> {
  const profile = await getCurrentUser();
  if (!profile) return { ok: false, error: "Not signed in" };
  if (!["SCM", "ADMIN"].includes(profile.role as string))
    return { ok: false, error: "Only SCM or Admin can set ETD here" };
  const value = parseDateInput(etd);
  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_orders")
    .update({ etd: value })
    .eq("id", poId);
  if (error) return { ok: false, error: error.message };
  revalidatePo(poId);
  return { ok: true };
}

// updateTargetedEta — SCM's ideal ETA-to-port (also set in approvePO).
export async function updateTargetedEta(poId: string, date: string | null): Promise<ActionResult> {
  const profile = await getCurrentUser();
  if (!profile) return { ok: false, error: "Not signed in" };
  if (!["SCM", "ADMIN"].includes(profile.role as string))
    return { ok: false, error: "Only SCM or Admin can set the targeted ETA" };
  const value = parseDateInput(date);
  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_orders")
    .update({ targeted_eta: value })
    .eq("id", poId);
  if (error) return { ok: false, error: error.message };
  revalidatePo(poId);
  return { ok: true };
}

// updateLogisticsEta — LOGISTICS/SCM/ADMIN. The trigger re-anchors the payment
// due dates from the new effective ETA when the PO carries a rule.
export async function updateLogisticsEta(poId: string, date: string | null): Promise<ActionResult> {
  const profile = await getCurrentUser();
  if (!profile) return { ok: false, error: "Not signed in" };
  if (!["LOGISTICS", "SCM", "ADMIN"].includes(profile.role as string))
    return { ok: false, error: "Only Logistics, SCM or Admin can set the logistics ETA" };
  const value = parseDateInput(date);
  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_orders")
    .update({ logistics_eta: value })
    .eq("id", poId);
  if (error) return { ok: false, error: error.message };
  revalidatePo(poId);
  return { ok: true };
}

// updateEtaToWarehouse — LOGISTICS/SCM/ADMIN. Does not affect payment anchor.
export async function updateEtaToWarehouse(poId: string, date: string | null): Promise<ActionResult> {
  const profile = await getCurrentUser();
  if (!profile) return { ok: false, error: "Not signed in" };
  if (!["LOGISTICS", "SCM", "ADMIN"].includes(profile.role as string))
    return { ok: false, error: "Only Logistics, SCM or Admin can set the warehouse ETA" };
  const value = parseDateInput(date);
  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_orders")
    .update({ eta_to_warehouse: value })
    .eq("id", poId);
  if (error) return { ok: false, error: error.message };
  revalidatePo(poId);
  revalidatePath("/warehouse");
  return { ok: true };
}

// updateClearanceStatus — LOGISTICS/SCM/ADMIN. Validated against the enum.
export async function updateClearanceStatus(poId: string, status: string): Promise<ActionResult> {
  const profile = await getCurrentUser();
  if (!profile) return { ok: false, error: "Not signed in" };
  if (!["LOGISTICS", "SCM", "ADMIN"].includes(profile.role as string))
    return { ok: false, error: "Only Logistics, SCM or Admin can set clearance status" };
  if (!isClearanceStatus(status))
    return { ok: false, error: "Invalid clearance status" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_orders")
    .update({ clearance_status: status })
    .eq("id", poId);
  if (error) return { ok: false, error: error.message };
  revalidatePo(poId);
  return { ok: true };
}

// setEtaDelayed — LOGISTICS/SCM/ADMIN. Toggles the delay flag + reason.
export async function setEtaDelayed(
  poId: string,
  delayed: boolean,
  reason: string | null
): Promise<ActionResult> {
  const profile = await getCurrentUser();
  if (!profile) return { ok: false, error: "Not signed in" };
  if (!["LOGISTICS", "SCM", "ADMIN"].includes(profile.role as string))
    return { ok: false, error: "Only Logistics, SCM or Admin can flag a delay" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_orders")
    .update({
      eta_delayed: !!delayed,
      // Clear the reason when un-flagging so stale text doesn't linger.
      delay_reason: delayed ? (reason?.trim() || null) : null,
    })
    .eq("id", poId);
  if (error) return { ok: false, error: error.message };
  revalidatePo(poId);
  return { ok: true };
}

// updateOceanFreight — SCM/ADMIN/FINANCE/ACCOUNTS. Sets the ocean freight add-on
// cost + its currency (usually USD). A null cost clears both fields. Routed
// through the admin client so it works regardless of the actor's RLS (mirrors the
// per-supplier cost writes). Revalidates the PO detail + finance + PO list where
// the landed total is surfaced.
const OCEAN_FREIGHT_CURRENCIES = ["MYR", "USD", "CNY", "THB"] as const;

export async function updateOceanFreight(
  poId: string,
  cost: number | null,
  currency: string | null
): Promise<ActionResult> {
  await requireRole("SCM", "ADMIN", "FINANCE", "ACCOUNTS");
  if (!poId) return { ok: false, error: "Missing PO" };

  // Clearing: a null/blank cost wipes both columns.
  if (cost == null) {
    const admin = createAdminClient();
    const { error } = await admin
      .from("purchase_orders")
      .update({ ocean_freight_cost: null, ocean_freight_currency: null })
      .eq("id", poId);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/purchase-orders/${poId}`);
    revalidatePath("/purchase-orders");
    revalidatePath("/finance");
    return { ok: true };
  }

  if (!Number.isFinite(cost) || cost < 0)
    return { ok: false, error: "Ocean freight cost must be a number ≥ 0" };

  // Default to USD when a cost is given but no currency.
  const cur = (currency || "USD").trim().toUpperCase();
  if (!OCEAN_FREIGHT_CURRENCIES.includes(cur as never))
    return { ok: false, error: "Currency must be one of MYR, USD, CNY, THB" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("purchase_orders")
    .update({
      ocean_freight_cost: Math.round(cost * 100) / 100,
      ocean_freight_currency: cur,
    })
    .eq("id", poId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath("/purchase-orders");
  revalidatePath("/finance");
  return { ok: true };
}

// applyPoTiming — SCM/ADMIN accept (or override) a proposed delay/expedite ETA
// from the Insights "Insights & Actions" tasks. Applies the chosen ETA to the
// PO + its in-transit incoming lines (so the dashboard re-buckets by ETA),
// records a resolved po_timing_actions row (so the task visibly moves to
// "Recently resolved"), and revalidates the affected views. Writes route
// through the service-role client (po_timing_actions + incoming_stock writes
// are SCM/ADMIN); the requireRole above is the security boundary.
export async function applyPoTiming(
  poId: string,
  actionType: "delay" | "expedite",
  chosenEta: string
): Promise<ActionResult> {
  const profile = await requireRole("SCM", "ADMIN");

  if (!poId) return { ok: false, error: "Missing PO" };
  if (actionType !== "delay" && actionType !== "expedite")
    return { ok: false, error: "Invalid action type" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(chosenEta))
    return { ok: false, error: "A valid date (YYYY-MM-DD) is required" };

  const admin = createAdminClient();

  // 1. Update the PO's ETA fields per the action taken.
  //    delay  → push the warehouse ETA out + flag the delay.
  //    expedite → pull the logistics ETA forward + clear the delay flag.
  const poUpdate: Record<string, unknown> =
    actionType === "delay"
      ? {
          eta_to_warehouse: chosenEta,
          eta_delayed: true,
          delay_reason: "SCM: delayed (overstock)",
        }
      : {
          logistics_eta: chosenEta,
          eta_delayed: false,
        };
  const { error: poErr } = await admin
    .from("purchase_orders")
    .update(poUpdate)
    .eq("id", poId);
  if (poErr) return { ok: false, error: poErr.message };

  // 2. Re-date the PO's in-transit lines so the dashboard re-buckets by ETA.
  const { error: incErr } = await admin
    .from("incoming_stock")
    .update({ expected_date: chosenEta })
    .eq("po_id", poId)
    .eq("status", "EXPECTED");
  if (incErr) return { ok: false, error: incErr.message };

  // 3. Record the resolved timing action (audit + drives "Recently resolved").
  //    resolved_at is set explicitly so the page's 21-day recency filter matches.
  const { error: actErr } = await admin.from("po_timing_actions").insert({
    po_id: poId,
    action_type: actionType,
    chosen_eta: chosenEta,
    status: "resolved",
    resolved_by: profile.id,
    resolved_at: new Date().toISOString(),
    note: null,
  });
  if (actErr) return { ok: false, error: actErr.message };

  revalidatePath("/insights");
  revalidatePath("/dashboard");
  revalidatePath(`/purchase-orders/${poId}`);
  return { ok: true };
}

// updateActualPortArrival — LOGISTICS/SCM/ADMIN. The actual arrival is the
// highest-priority ETA source, so the trigger re-anchors the payment due dates
// off it when the PO carries a rule.
export async function updateActualPortArrival(poId: string, date: string | null): Promise<ActionResult> {
  const profile = await getCurrentUser();
  if (!profile) return { ok: false, error: "Not signed in" };
  if (!["LOGISTICS", "SCM", "ADMIN"].includes(profile.role as string))
    return { ok: false, error: "Only Logistics, SCM or Admin can set the actual port arrival" };
  const value = parseDateInput(date);
  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_orders")
    .update({ actual_eta: value })
    .eq("id", poId);
  if (error) return { ok: false, error: error.message };
  revalidatePo(poId);
  revalidatePath("/warehouse");
  return { ok: true };
}
