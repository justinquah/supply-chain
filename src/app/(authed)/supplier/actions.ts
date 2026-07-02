"use server";

import { createClient, requireRole } from "@/lib/supabase/server";

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
