"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

const CAN_WRITE = ["SUPER_ADMIN", "SCM", "ADMIN", "FINANCE", "LOGISTICS"];

// doc_type -> storage bucket
const BUCKET: Record<string, string> = {
  PO_PDF: "po-pdfs",
  SUPPLIER_INVOICE: "invoices",
  BL: "shipping-docs",
  PACKING_LIST: "shipping-docs",
  K1_FINAL: "shipping-docs",
};

// form field name -> doc_type
const FIELD_TO_DOCTYPE: Record<string, string> = {
  file_po: "PO_PDF",
  file_invoice: "SUPPLIER_INVOICE",
  file_bl: "BL",
  file_pl: "PACKING_LIST",
  file_k1: "K1_FINAL",
};

function slug(s: string) {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

export async function savePurchaseOrder(
  formData: FormData
): Promise<{ ok: boolean; error?: string; uploaded?: number }> {
  const profile = await getCurrentUser();
  if (!profile) return { ok: false, error: "Not signed in" };
  if (!CAN_WRITE.includes(profile.role))
    return { ok: false, error: "You don't have permission to add POs" };

  const supabase = await createClient();

  const poNumber = String(formData.get("po_number") || "").trim();
  const invoiceNumber = String(formData.get("invoice_number") || "").trim();
  const supplierId = String(formData.get("supplier_id") || "").trim() || null;
  const productGroup = String(formData.get("product_group") || "").trim() || null;
  const invoiceAmount = formData.get("invoice_amount")
    ? Number(formData.get("invoice_amount"))
    : null;
  const invoiceCurrency =
    String(formData.get("invoice_currency") || "MYR").trim() || "MYR";
  const notes = String(formData.get("notes") || "").trim() || null;

  if (!poNumber)
    return { ok: false, error: "PO number is required" };

  // Upsert the PO by po_number
  const { data: existing } = await supabase
    .from("purchase_orders")
    .select("id")
    .eq("po_number", poNumber)
    .maybeSingle();

  let poId: string;
  const poFields = {
    po_number: poNumber,
    invoice_number: invoiceNumber || null,
    invoice_amount: invoiceAmount,
    invoice_currency: invoiceCurrency,
    supplier_id: supplierId,
    product_group: productGroup,
    notes,
    status: "ISSUED" as const,
    proposal_source: "MANUAL_SCM" as const,
  };

  if (existing) {
    poId = existing.id;
    const { error } = await supabase
      .from("purchase_orders")
      .update(poFields)
      .eq("id", poId);
    if (error) return { ok: false, error: error.message };
  } else {
    const { data, error } = await supabase
      .from("purchase_orders")
      .insert(poFields)
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error?.message || "Insert failed" };
    poId = data.id;
  }

  // Upload any provided files
  let uploaded = 0;
  for (const [field, docType] of Object.entries(FIELD_TO_DOCTYPE)) {
    const file = formData.get(field) as File | null;
    if (!file || typeof file === "string" || file.size === 0) continue;

    const bucket = BUCKET[docType];
    const path = `${poId}/${docType}/${Date.now()}_${slug(file.name)}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(path, buffer, {
        contentType: file.type || "application/octet-stream",
        upsert: true,
      });
    if (upErr) return { ok: false, error: `Upload failed (${docType}): ${upErr.message}` };

    const { error: docErr } = await supabase.from("po_documents").insert({
      po_id: poId,
      doc_type: docType,
      file_path: `${bucket}/${path}`,
      file_name: file.name,
      uploaded_by: profile.id,
      approval_status:
        docType === "K1_FINAL" ? "PENDING" : "NOT_REQUIRED",
    });
    if (docErr) return { ok: false, error: `Record failed (${docType}): ${docErr.message}` };
    uploaded++;
  }

  revalidatePath("/purchase-orders");
  return { ok: true, uploaded };
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
