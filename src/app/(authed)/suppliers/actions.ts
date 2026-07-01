"use server";

import { revalidatePath } from "next/cache";
import { requireRole, getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type ActionResult = { ok: boolean; error?: string };

const CURRENCIES = ["MYR", "USD", "CNY", "THB"] as const;
type Currency = (typeof CURRENCIES)[number];

function isCurrency(v: string): v is Currency {
  return (CURRENCIES as readonly string[]).includes(v);
}

// Today's date in Asia/Kuala_Lumpur as YYYY-MM-DD, for cost-history effective_from.
function todayKL(): string {
  const nowKL = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" })
  );
  const y = nowKL.getFullYear();
  const m = String(nowKL.getMonth() + 1).padStart(2, "0");
  const d = String(nowKL.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function revalidateSuppliers() {
  revalidatePath("/suppliers");
  revalidatePath("/products");
}

/**
 * Update a supplier's payment terms + deposit percent.
 * Gated to SCM/ADMIN. Writes via admin (service-role) client to avoid RLS
 * friction on profiles — the app-layer role check is the security boundary.
 */
export async function updateSupplierTerms(
  supplierId: string,
  paymentTerms: string,
  depositPercent: number | null
): Promise<ActionResult> {
  await requireRole("SCM", "ADMIN");

  if (!supplierId) return { ok: false, error: "Missing supplier" };
  if (
    depositPercent != null &&
    (Number.isNaN(depositPercent) || depositPercent < 0 || depositPercent > 100)
  ) {
    return { ok: false, error: "Deposit % must be between 0 and 100" };
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("profiles")
    .update({
      supplier_payment_terms: paymentTerms || null,
      supplier_deposit_percent: depositPercent,
    })
    .eq("id", supplierId);

  if (error) return { ok: false, error: error.message };

  revalidateSuppliers();
  return { ok: true };
}

/**
 * Assign a product to a supplier — upserts product_suppliers and appends a
 * product_supplier_cost_history row so the cost trend is preserved from day one.
 * Gated to SCM/ADMIN.
 */
export async function assignProduct(
  supplierId: string,
  productId: string,
  cost: number,
  currency: string,
  isPrimary: boolean
): Promise<ActionResult> {
  const profile = await requireRole("SCM", "ADMIN");

  if (!supplierId || !productId) return { ok: false, error: "Missing supplier or product" };
  if (Number.isNaN(cost) || cost < 0) return { ok: false, error: "Cost must be a positive number" };
  if (!isCurrency(currency)) return { ok: false, error: "Invalid currency" };

  const adminClient = createAdminClient();

  // If this is set as primary, unset any existing primary flag for this product first
  // (uq_product_suppliers_primary is a partial unique index on product_id WHERE is_primary).
  if (isPrimary) {
    const { error: unsetErr } = await adminClient
      .from("product_suppliers")
      .update({ is_primary: false })
      .eq("product_id", productId)
      .eq("is_primary", true);
    if (unsetErr) return { ok: false, error: unsetErr.message };
  }

  const { error } = await adminClient.from("product_suppliers").upsert(
    {
      product_id: productId,
      supplier_id: supplierId,
      unit_cost: cost,
      cost_currency: currency,
      is_primary: isPrimary,
    },
    { onConflict: "product_id,supplier_id" }
  );
  if (error) return { ok: false, error: error.message };

  const { error: histErr } = await adminClient
    .from("product_supplier_cost_history")
    .insert({
      product_id: productId,
      supplier_id: supplierId,
      unit_cost: cost,
      cost_currency: currency,
      effective_from: todayKL(),
      note: "Assigned to supplier",
      recorded_by: profile.id,
    });
  if (histErr) return { ok: false, error: histErr.message };

  revalidateSuppliers();
  return { ok: true };
}

/**
 * Update the cost for an existing (product, supplier) pair. Updates the
 * current cost on product_suppliers AND appends a cost-history row so the
 * price trend is preserved.
 * Gated to SCM/ADMIN.
 */
export async function updateCost(
  productId: string,
  supplierId: string,
  newCost: number,
  currency: string,
  note?: string
): Promise<ActionResult> {
  const profile = await requireRole("SCM", "ADMIN");

  if (!productId || !supplierId) return { ok: false, error: "Missing product or supplier" };
  if (Number.isNaN(newCost) || newCost < 0) return { ok: false, error: "Cost must be a positive number" };
  if (!isCurrency(currency)) return { ok: false, error: "Invalid currency" };

  const adminClient = createAdminClient();

  const { error } = await adminClient
    .from("product_suppliers")
    .update({ unit_cost: newCost, cost_currency: currency })
    .eq("product_id", productId)
    .eq("supplier_id", supplierId);
  if (error) return { ok: false, error: error.message };

  const { error: histErr } = await adminClient
    .from("product_supplier_cost_history")
    .insert({
      product_id: productId,
      supplier_id: supplierId,
      unit_cost: newCost,
      cost_currency: currency,
      effective_from: todayKL(),
      note: note?.trim() || null,
      recorded_by: profile.id,
    });
  if (histErr) return { ok: false, error: histErr.message };

  revalidateSuppliers();
  return { ok: true };
}

/**
 * Remove a product from a supplier (deletes the product_suppliers row).
 * Cost history rows are kept for the audit trail (not deleted).
 * Gated to SCM/ADMIN.
 */
export async function removeProduct(
  productId: string,
  supplierId: string
): Promise<ActionResult> {
  await requireRole("SCM", "ADMIN");

  if (!productId || !supplierId) return { ok: false, error: "Missing product or supplier" };

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("product_suppliers")
    .delete()
    .eq("product_id", productId)
    .eq("supplier_id", supplierId);
  if (error) return { ok: false, error: error.message };

  revalidateSuppliers();
  return { ok: true };
}
