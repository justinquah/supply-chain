"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type ActionResult = { ok: boolean; error?: string };

export const DEV_STATUSES = [
  "PLANNED",
  "IN_PROGRESS",
  "LAUNCHED",
  "ON_HOLD",
  "CANCELLED",
] as const;
type DevStatus = (typeof DEV_STATUSES)[number];

function isDevStatus(v: string): v is DevStatus {
  return (DEV_STATUSES as readonly string[]).includes(v);
}

// Read a DATE field from FormData; empty string -> null.
function dateOrNull(v: FormDataEntryValue | null): string | null {
  const s = (v == null ? "" : String(v)).trim();
  return s === "" ? null : s;
}

function textOrNull(v: FormDataEntryValue | null): string | null {
  const s = (v == null ? "" : String(v)).trim();
  return s === "" ? null : s;
}

/**
 * Create a product-development pipeline item. Gated to SCM/ADMIN; writes via the
 * admin (service-role) client — the app-layer role check is the security boundary.
 */
export async function createDevItem(formData: FormData): Promise<ActionResult> {
  const profile = await requireRole("SCM", "ADMIN");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Name is required" };

  const status = String(formData.get("status") ?? "PLANNED").trim() || "PLANNED";
  if (!isDevStatus(status)) return { ok: false, error: "Invalid status" };

  const admin = createAdminClient();
  const { error } = await admin.from("product_development_items").insert({
    name,
    product_family: textOrNull(formData.get("product_family")),
    variation: textOrNull(formData.get("variation")),
    planned_launch_date: dateOrNull(formData.get("planned_launch_date")),
    status,
    linked_product_id: textOrNull(formData.get("linked_product_id")),
    notes: textOrNull(formData.get("notes")),
    created_by: profile.id,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/development");
  return { ok: true };
}

/**
 * Update an existing pipeline item. Gated to SCM/ADMIN.
 */
export async function updateDevItem(
  id: string,
  formData: FormData
): Promise<ActionResult> {
  await requireRole("SCM", "ADMIN");

  if (!id) return { ok: false, error: "Missing item id" };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Name is required" };

  const status = String(formData.get("status") ?? "PLANNED").trim() || "PLANNED";
  if (!isDevStatus(status)) return { ok: false, error: "Invalid status" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("product_development_items")
    .update({
      name,
      product_family: textOrNull(formData.get("product_family")),
      variation: textOrNull(formData.get("variation")),
      planned_launch_date: dateOrNull(formData.get("planned_launch_date")),
      status,
      linked_product_id: textOrNull(formData.get("linked_product_id")),
      notes: textOrNull(formData.get("notes")),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/development");
  return { ok: true };
}

/**
 * Delete a pipeline item. Gated to SCM/ADMIN.
 */
export async function deleteDevItem(id: string): Promise<ActionResult> {
  await requireRole("SCM", "ADMIN");

  if (!id) return { ok: false, error: "Missing item id" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("product_development_items")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/development");
  return { ok: true };
}
