"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

type ActionResult = { ok: boolean; error?: string };

function slug(s: string) {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

/**
 * Record a payment for a PO.
 * FINANCE-only (RLS on payments: pay_write allows FINANCE only).
 * ADMIN can read payments but CANNOT write them under the current RLS.
 */
export async function recordPayment(formData: FormData): Promise<ActionResult> {
  const profile = await getCurrentUser();
  if (!profile) return { ok: false, error: "Not signed in" };
  if (profile.role !== "FINANCE")
    return { ok: false, error: "Only Finance can record payments" };

  const supabase = await createClient();

  const poId = String(formData.get("po_id") || "").trim();
  if (!poId) return { ok: false, error: "Missing PO" };

  const amountRaw = formData.get("amount");
  const amount = amountRaw ? Number(amountRaw) : NaN;
  if (Number.isNaN(amount) || amount <= 0)
    return { ok: false, error: "Amount must be a positive number" };

  const currency = String(formData.get("currency") || "MYR").trim();
  const paidAt = String(formData.get("paid_at") || "").trim();
  if (!paidAt) return { ok: false, error: "Paid date is required" };

  const leg = String(formData.get("leg") || "OTHER").trim(); // "DEPOSIT" | "BALANCE" | "OTHER"
  const notes = String(formData.get("notes") || "").trim() || null;

  // Resolve payee_name from the PO's supplier
  const { data: po } = await supabase
    .from("purchase_orders")
    .select(
      "deposit_due_date, balance_due_date, supplier:profiles!supplier_id(name, company_name)"
    )
    .eq("id", poId)
    .maybeSingle();

  if (!po) return { ok: false, error: "PO not found" };

  const poRow = po as any;
  const supplier = poRow.supplier as { name?: string; company_name?: string } | null;
  const payeeName = supplier?.company_name || supplier?.name || null;

  // Map leg → due_date on the payment row (Finance calendar uses this)
  let dueDate: string | null = null;
  if (leg === "DEPOSIT") dueDate = poRow.deposit_due_date ?? null;
  else if (leg === "BALANCE") dueDate = poRow.balance_due_date ?? null;

  // Combine leg label with any user notes
  const combinedNotes = [leg !== "OTHER" ? `Leg: ${leg}` : null, notes]
    .filter(Boolean)
    .join(" — ") || null;

  // Optional payment slip upload → payment-slips bucket
  let paymentSlipPath: string | null = null;
  const slipFile = formData.get("payment_slip");
  if (slipFile && typeof slipFile !== "string" && (slipFile as File).size > 0) {
    const file = slipFile as File;
    const path = `${poId}/${Date.now()}_${slug(file.name)}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: upErr } = await supabase.storage
      .from("payment-slips")
      .upload(path, buffer, {
        contentType: file.type || "application/octet-stream",
        upsert: true,
      });
    if (upErr) return { ok: false, error: `Slip upload failed: ${upErr.message}` };
    paymentSlipPath = `payment-slips/${path}`;
  }

  const { error } = await supabase.from("payments").insert({
    po_id: poId,
    payment_type: "SUPPLIER" as const,
    payee_name: payeeName,
    amount,
    currency,
    due_date: dueDate,
    status: "PAID" as const,
    paid_at: new Date(paidAt).toISOString(),
    payment_slip_path: paymentSlipPath,
    recorded_by: profile.id,
    notes: combinedNotes,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/finance");
  revalidatePath(`/purchase-orders/${poId}`);
  return { ok: true };
}

/** Generate a short-lived signed URL for a payment slip (private bucket). */
export async function getSlipUrl(filePath: string): Promise<string | null> {
  const supabase = await createClient();
  const slashIdx = filePath.indexOf("/");
  const bucket = filePath.slice(0, slashIdx);
  const path = filePath.slice(slashIdx + 1);
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}
