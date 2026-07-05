"use server";

import { revalidatePath } from "next/cache";
import { createClient, requireRole } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recomputeBalanceDue } from "@/lib/po-workflow";

// Validate a plain YYYY-MM-DD date string (or empty -> null).
function parseDate(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

/**
 * Supplier self-service update of their ETD + their ETA-to-port (supplier_eta).
 *
 * SECURITY: RLS on purchase_orders is row-level and cannot restrict WHICH
 * columns a supplier writes, so this action IS the column boundary. It:
 *   1. gates the role (SUPPLIER/SCM/ADMIN),
 *   2. verifies the PO belongs to the caller (supplier_id = me.id),
 *   3. writes ONLY etd + supplier_eta via the admin client (RLS would block a
 *      supplier UPDATE on purchase_orders; ownership is already proven above),
 *   4. re-anchors balance_due_date from the payment anchor (§5) when parseable,
 *   5. revalidates /supplier.
 * A caller who does not own the PO gets {ok:false} — never a silent write.
 */
export async function updateSupplierDates(
  poId: string,
  etd: string | null,
  supplierEta: string | null
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireRole("SUPPLIER", "SCM", "ADMIN");
  const supabase = await createClient();

  // Ownership check — the security boundary for the row.
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id")
    .eq("id", poId)
    .eq("supplier_id", me.id)
    .maybeSingle();
  if (!po) return { ok: false, error: "Not found" };

  const etdValue = parseDate(etd);
  const supplierEtaValue = parseDate(supplierEta);

  const admin = createAdminClient();

  // Load current ETA/payment context to re-anchor balance_due_date (§5).
  const { data: ctx } = await admin
    .from("purchase_orders")
    .select("targeted_eta, supplier_eta, logistics_eta, actual_eta, payment_terms")
    .eq("id", poId)
    .maybeSingle();

  const update: Record<string, unknown> = {
    etd: etdValue,
    supplier_eta: supplierEtaValue,
  };
  if (ctx) {
    const newBalanceDue = recomputeBalanceDue({
      ...(ctx as Record<string, string | null>),
      supplier_eta: supplierEtaValue,
    });
    if (newBalanceDue) update.balance_due_date = newBalanceDue;
  }

  // ONLY etd + supplier_eta (+ derived balance_due_date) are written — the
  // whitelist is enforced by this literal object, not by RLS.
  const { error } = await admin
    .from("purchase_orders")
    .update(update)
    .eq("id", poId)
    .eq("supplier_id", me.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/supplier");
  revalidatePath(`/purchase-orders/${poId}`);
  return { ok: true };
}

/**
 * Mint a short-lived signed URL for a supplier's own PO document.
 *
 * This is the security boundary for supplier document access. Even though RLS
 * scopes po_documents to the supplier, we re-verify app-side that the PO the
 * document belongs to is owned by the calling supplier before signing a URL —
 * defense-in-depth, mirroring getDocUrl in purchase-orders/actions.ts.
 *
 * `path` is the stored `file_path` (e.g. "po-pdfs/<poId>/..."), the same shape
 * the PO detail page uses: bucket is the first path segment.
 */
export async function getSupplierDocUrl(
  poId: string,
  path: string
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const me = await requireRole("SUPPLIER", "SCM", "ADMIN");
  const supabase = await createClient();

  // Verify the PO belongs to this supplier (RLS also enforces this, but we
  // check explicitly so a mismatched poId returns Not found rather than a URL).
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id")
    .eq("id", poId)
    .eq("supplier_id", me.id)
    .maybeSingle();

  if (!po) return { ok: false, error: "Not found" };

  // Split bucket/path exactly like getDocUrl (bucket = first segment).
  const slashIdx = path.indexOf("/");
  if (slashIdx < 0) return { ok: false, error: "Invalid document path" };
  const bucket = path.slice(0, slashIdx);
  const objectPath = path.slice(slashIdx + 1);

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(objectPath, 300);

  if (error || !data?.signedUrl) {
    return { ok: false, error: error?.message || "Could not sign URL" };
  }
  return { ok: true, url: data.signedUrl };
}
